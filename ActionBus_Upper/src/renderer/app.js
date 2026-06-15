'use strict';
/* ============================================================
   ActionBus Master — Renderer
   ============================================================ */

/* ── Window controls ─────────────────────────────────────── */
document.getElementById('btn-min').addEventListener('click',   () => window.electronAPI.minimize());
document.getElementById('btn-max').addEventListener('click',   () => window.electronAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.electronAPI.close());

/* ============================================================
   PROTOCOL — CRC / Frame builder / Frame parser
   ============================================================ */

function crc16modbus(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) {
        crc ^= b;
        for (let i = 0; i < 8; i++)
            crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
    return crc;
}

function parseHexStr(str) {
    return str.trim().replace(/0x/gi, '').split(/[\s,]+/)
        .filter(Boolean).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
}

function buildFrame(addr, func, stat, data = []) {
    const body = [addr, func, stat, data.length, ...data];
    const crc  = crc16modbus(body);
    return [0xAA, 0x55, ...body, (crc >> 8) & 0xFF, crc & 0xFF];
}

/** Known ActionBus function codes */
const AB_FUNC = {
    0x01: 'LED Control',
    0x02: 'LED Blink',
    0x0A: 'Temperature',
    0x0B: 'IMU Attitude',
    0x0C: 'ADC Read',
    0x0D: 'Device Status',
    0x10: 'File Transfer',
    0x20: 'Echo',
    0xF0: 'Protocol Query',
    0xFE: 'Action Desc',
};

function s16(hi, lo) {
    const v = ((hi & 0xFF) << 8) | (lo & 0xFF);
    return v > 0x7FFF ? v - 0x10000 : v;
}

function decodePayload(func, stat, data) {
    const sw  = (stat & 0x01) !== 0;
    const err = (stat & 0x80) !== 0;
    const dir = (stat & 0x10) ? 'tx' : 'rx';

    if (err)
        return { dir, text: `ERR 0x${(data[0] ?? 0).toString(16).toUpperCase().padStart(2,'0')}`, status: 'err' };

    if (!sw && !(stat & 0x10))
        return { dir, text: '已停止 / 完成', status: 'ok' };

    let text = '';
    switch (func) {
        case 0x01:
            if (data.length >= 1) {
                const m = data[0] & 0x03;
                text = sw
                    ? `点亮 ${m & 1 ? 'LED1' : ''}${m & 2 ? ' LED2' : ''} (mask=${m})`
                    : '全灭';
            }
            break;
        case 0x02:
            if (data.length >= 2)
                text = sw
                    ? `mask=${data[0]}  interval=${data[1] * 100}ms`
                    : '停止闪烁';
            break;
        case 0x0A:
            if (data.length >= 2) {
                const t = s16(data[0], data[1]);
                text = `${(t / 100).toFixed(2)} °C`;
            }
            break;
        case 0x0B:
            if (data.length >= 6) {
                const r = s16(data[0], data[1]);
                const p = s16(data[2], data[3]);
                const y = s16(data[4], data[5]);
                text = `Roll ${(r/100).toFixed(2)}°  Pitch ${(p/100).toFixed(2)}°  Yaw ${(y/100).toFixed(2)}°`;
            }
            break;
        case 0x0C:
            if (data.length >= 3) {
                const val = (data[1] << 8) | data[2];
                text = `ch${data[0]}  ${val}  (${(val / 4095 * 100).toFixed(1)}%)`;
            }
            break;
        case 0x0D:
            if (data.length >= 8) {
                const up = ((data[0]<<24)|(data[1]<<16)|(data[2]<<8)|data[3]) >>> 0;
                const ct = s16(data[4], data[5]);
                text = `uptime ${(up/1000).toFixed(1)}s  cpu ${(ct/100).toFixed(2)}°C  tasks ${data[6]}  addr 0x${data[7].toString(16).padStart(2,'0')}`;
            }
            break;
        case 0x10: {
            const sub = ['INIT','DATA','END','ABORT'];
            if (data.length >= 1) {
                text = sub[data[0]] ?? `SubCmd=0x${data[0].toString(16)}`;
                if (data[0] === 0x01 && data.length >= 3)
                    text += `  seq=${(data[1]<<8)|data[2]}  ${data.length - 3}B`;
                if (data[0] === 0x02 && data.length >= 4) {
                    const n = ((data[1]<<24)|(data[2]<<16)|(data[3]<<8)|data[4]) >>> 0;
                    text += `  已接收 ${n}B`;
                }
            }
            break;
        }
        case 0x20: {
            const ascii = String.fromCharCode(...data.filter(b => b >= 0x20 && b < 0x7F));
            text = `"${ascii}"  [${data.length}B]`;
            break;
        }
        case 0xF0: {
            const names = {0:'GET_PROTOCOL_VERSION',1:'GET_DEVICE_ID',2:'GET_ACTION_COUNT',3:'GET_UPTIME_MS',4:'GET_BUS_ADDRESS'};
            if (data.length >= 1) text = (names[data[0]] ?? `SubCmd=0x${data[0].toString(16)}`);
            if (data[0] === 0x00 && data.length >= 3) text += `  v${data[1]}.${data[2]}`;
            if (data[0] === 0x02 && data.length >= 2) text += `  count=${data[1]}`;
            break;
        }
        case 0xFE:
            if (data.length >= 1 && data[0] === 0x01 && data.length >= 3) {
                const fc   = data[1];
                const desc = String.fromCharCode(...data.slice(3));
                text = `0x${fc.toString(16).padStart(2,'0').toUpperCase()} → ${desc}`;
            }
            break;
        default:
            text = data.length
                ? data.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ')
                : '(no data)';
    }

    return { dir, text: text || '—', status: 'ok' };
}

/* ============================================================
   SERIAL PORT
   ============================================================ */

let connected    = false;
const rxBuffer   = [];

async function refreshPortList() {
    const result = await window.electronAPI.serial.list();
    if (!result.ok) return;
    const sel  = document.getElementById('port-select');
    const prev = sel.value;
    sel.innerHTML = '';
    for (const p of result.ports) {
        const opt = document.createElement('option');
        opt.value       = p.path;
        opt.textContent = p.manufacturer ? `${p.path}  (${p.manufacturer})` : p.path;
        sel.appendChild(opt);
    }
    /* Fallback options if nothing found */
    if (!result.ports.length) {
        ['/dev/ttyUSB0','/dev/ttyUSB1','/dev/ttyACM0','COM3','COM4'].forEach(v => {
            const opt = document.createElement('option');
            opt.value = opt.textContent = v;
            sel.appendChild(opt);
        });
    }
    if (prev) sel.value = prev;
}

async function doConnect() {
    const portPath = document.getElementById('port-select').value;
    const baud     = document.getElementById('baud-select').value === 'custom'
        ? document.getElementById('baud-select').dataset.customVal || '115200'
        : document.getElementById('baud-select').value;

    appendDecodedLog('info', new Date(), '—', 'System', `正在连接 ${portPath} @ ${baud}…`, 'val');

    const result = await window.electronAPI.serial.connect(portPath, baud);
    if (result.ok) {
        setConnected(true);
        appendDecodedLog('info', new Date(), '—', 'System', `已连接 ${portPath}`, 'ok');
    } else {
        appendDecodedLog('info', new Date(), '—', 'System', `连接失败: ${result.error}`, 'err');
    }
}

async function doDisconnect() {
    await window.electronAPI.serial.disconnect();
    setConnected(false);
    appendDecodedLog('info', new Date(), '—', 'System', '已断开连接', 'val');
}

function setConnected(val) {
    connected = val;
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const btn  = document.getElementById('btn-connect');
    if (val) {
        dot.className  = 'status-dot connected';
        text.className = 'status-text connected';
        text.textContent = 'CONNECTED';
        btn.textContent  = 'Disconnect';
        btn.classList.replace('primary', 'danger');
    } else {
        dot.className  = 'status-dot';
        text.className = 'status-text';
        text.textContent = 'DISCONNECTED';
        btn.textContent  = 'Connect';
        btn.classList.replace('danger', 'primary');
        rxBuffer.length = 0;
    }
}

async function serialSend(bytes) {
    if (!connected) {
        appendDecodedLog('info', new Date(), '—', 'System', '未连接', 'err');
        return false;
    }
    const result = await window.electronAPI.serial.send(bytes);
    if (!result.ok) {
        appendDecodedLog('info', new Date(), '—', 'System', `发送失败: ${result.error}`, 'err');
        return false;
    }
    return true;
}

/* ── Frame reception pipeline ─────────────────────────── */
window.electronAPI.serial.onData(bytes => {
    rxBuffer.push(...bytes);
    processRxBuffer();
});

window.electronAPI.serial.onError(msg => {
    appendDecodedLog('info', new Date(), '—', 'System', `串口错误: ${msg}`, 'err');
});

window.electronAPI.serial.onClosed(() => {
    if (connected) {
        setConnected(false);
        appendDecodedLog('info', new Date(), '—', 'System', '串口意外断开', 'err');
    }
});

function processRxBuffer() {
    while (true) {
        /* Find AA 55 sync */
        let start = -1;
        for (let i = 0; i < rxBuffer.length - 1; i++) {
            if (rxBuffer[i] === 0xAA && rxBuffer[i + 1] === 0x55) { start = i; break; }
        }
        if (start < 0) { if (rxBuffer.length > 1) rxBuffer.splice(0, rxBuffer.length - 1); break; }
        if (start > 0) rxBuffer.splice(0, start);
        if (rxBuffer.length < 6) break;

        const dataLen  = rxBuffer[5];
        const frameLen = 6 + dataLen + 2;
        if (rxBuffer.length < frameLen) break;

        const frame   = rxBuffer.splice(0, frameLen);
        const crcCalc = crc16modbus(frame.slice(2, 6 + dataLen));
        const crcRx   = (frame[6 + dataLen] << 8) | frame[7 + dataLen];

        if (crcCalc !== crcRx) {
            const hex = frame.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
            appendFrameLog('rx', new Date(), hex, 'CRC错误', true);
            continue;
        }

        const addr = frame[2];
        const func = frame[3];
        const stat = frame[4];
        const data = frame.slice(6, 6 + dataLen);
        const hex  = frame.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
        const name = AB_FUNC[func] ?? `0x${func.toString(16).padStart(2,'0').toUpperCase()}`;

        appendFrameLog('rx', new Date(), hex, name);

        const decoded = decodePayload(func, stat, data);
        appendDecodedLog('rx', new Date(),
            `0x${func.toString(16).padStart(2,'0').toUpperCase()}`,
            name, decoded.text, decoded.status);

        /* Notify canvas widgets */
        busEmit(func, { func, stat, addr, data });
    }
}

/* ============================================================
   FRAME EVENT BUS  (widgets subscribe to data)
   ============================================================ */
const busListeners = {};
function busOn(func, cb) {
    if (!busListeners[func]) busListeners[func] = [];
    busListeners[func].push(cb);
    return () => { busListeners[func] = busListeners[func].filter(l => l !== cb); };
}
function busEmit(func, payload) {
    (busListeners[func]   || []).forEach(cb => cb(payload));
    (busListeners['*']    || []).forEach(cb => cb(payload));
}

/* ============================================================
   CONNECT BUTTON
   ============================================================ */
document.getElementById('btn-connect').addEventListener('click', () => {
    if (connected) doDisconnect(); else doConnect();
});

/* ============================================================
   ONE-CLICK SCAN
   ============================================================ */
document.getElementById('btn-scan').addEventListener('click', async () => {
    if (!connected) { appendDecodedLog('info', new Date(), '—', 'System', '请先连接串口', 'err'); return; }
    const addr = parseInt(document.getElementById('target-addr').value.trim(), 16) || 0x01;
    appendDecodedLog('info', new Date(), '—', 'System', `扫描设备 0x${addr.toString(16).padStart(2,'0')}…`, 'val');

    /* GET_PROTOCOL_VERSION */
    const vFrame = buildFrame(addr, 0xF0, 0x11, [0x00]);
    const hexV   = vFrame.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    appendFrameLog('tx', new Date(), hexV, 'GET_PROTOCOL_VERSION');
    await serialSend(vFrame);

    /* GET_ACTION_COUNT */
    await new Promise(r => setTimeout(r, 60));
    const cFrame = buildFrame(addr, 0xF0, 0x11, [0x02]);
    const hexC   = cFrame.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    appendFrameLog('tx', new Date(), hexC, 'GET_ACTION_COUNT');
    await serialSend(cFrame);
});

/* ============================================================
   PORT SELECT
   ============================================================ */
const baudSelect = document.getElementById('baud-select');
baudSelect.addEventListener('change', () => {
    if (baudSelect.value === 'custom') {
        const val = prompt('请输入波特率（1200–4000000）：');
        if (val && /^\d+$/.test(val) && +val >= 1200 && +val <= 4000000) {
            baudSelect.dataset.customVal = val;
            const opt = new Option(val, 'custom', true, true);
            baudSelect.insertBefore(opt, baudSelect.lastElementChild);
            baudSelect.value = 'custom';
        } else {
            baudSelect.value = '115200';
        }
    }
});

/* ============================================================
   MANUAL SEND BAR
   ============================================================ */
const toggleAssemble     = document.getElementById('toggle-assemble');
const sendSwLabel        = document.getElementById('send-sw-label');
const sendAssembleFields = document.getElementById('send-assemble-fields');
const sendRawFields      = document.getElementById('send-raw-fields');
const sendFuncInput      = document.getElementById('send-func');
const sendDataInput      = document.getElementById('send-data');
const sendRawInput       = document.getElementById('send-raw');

let assembleMode = false;
toggleAssemble.classList.remove('on');

toggleAssemble.addEventListener('click', () => {
    assembleMode = !assembleMode;
    toggleAssemble.classList.toggle('on', assembleMode);
    sendSwLabel.textContent           = assembleMode ? '组帧' : '原始';
    sendAssembleFields.style.display  = assembleMode ? '' : 'none';
    sendRawFields.style.display       = assembleMode ? 'none' : '';
});

function flashError(el) {
    el.classList.add('error');
    setTimeout(() => el.classList.remove('error'), 800);
}

async function doSend() {
    let frameBytes;
    if (assembleMode) {
        const addr = parseInt(document.getElementById('target-addr').value.trim(), 16);
        const func = parseInt(sendFuncInput.value.trim().replace(/^0x/i, ''), 16);
        const data = parseHexStr(sendDataInput.value);
        if (isNaN(addr) || isNaN(func)) { flashError(sendFuncInput); return; }
        frameBytes = buildFrame(addr, func, 0x11, data);
    } else {
        frameBytes = parseHexStr(sendRawInput.value);
        if (!frameBytes.length) { flashError(sendRawInput); return; }
    }

    const hexStr = frameBytes.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    const name   = assembleMode ? (AB_FUNC[frameBytes[3]] ?? '手动组帧') : '手动原始';
    appendFrameLog('tx', new Date(), hexStr, name);
    await serialSend(frameBytes);
}

document.getElementById('btn-manual-send').addEventListener('click', doSend);
[sendFuncInput, sendDataInput, sendRawInput].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
});

/* ============================================================
   LOGS
   ============================================================ */
const frameLogBody   = document.getElementById('frame-log-body');
const decodedLogBody = document.getElementById('decoded-log-body');
let frameAutoScroll  = true;
let decodedAutoScroll = true;

function fmtTime(d) {
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function appendFrameLog(dir, time, hex, note, crcErr = false) {
    const row = document.createElement('div');
    row.className = 'log-row' + (crcErr ? ' log-row-err' : '');

    /* Color-code bytes: header(AA 55) / addr / func / stat / len / data / crc */
    const parts = hex.split(' ');
    let colored = '';
    parts.forEach((b, i) => {
        let cls = 'byte-data';
        if (i < 2)  cls = 'byte-head';
        else if (i === 2) cls = 'byte-addr';
        else if (i === 3) cls = 'byte-func';
        else if (i === 4) cls = 'byte-stat';
        else if (i === 5) cls = 'byte-len';
        else if (i >= parts.length - 2) cls = 'byte-crc';
        colored += `<span class="${cls}">${b} </span>`;
    });

    row.innerHTML = `
        <span class="log-ts">${fmtTime(time)}</span>
        <span class="log-dir ${dir}">${dir === 'rx' ? 'RX' : 'TX'}</span>
        <span class="log-hex">${colored}</span>
        <span class="log-note">${note}</span>`;
    frameLogBody.appendChild(row);
    if (frameAutoScroll) frameLogBody.scrollTop = frameLogBody.scrollHeight;
}

function appendDecodedLog(dir, time, func, name, detail, status) {
    const row = document.createElement('div');
    row.className = 'decoded-row';
    const cls = status === 'ok' ? 'dc-ok' : status === 'err' ? 'dc-err' : 'dc-val';
    const dirLabel = dir === 'rx' ? 'RX' : dir === 'tx' ? 'TX' : '──';
    row.innerHTML = `
        <span class="decoded-ts">${fmtTime(time)}</span>
        <span class="log-dir ${dir === 'info' ? 'info' : dir}">${dirLabel}</span>
        <span class="decoded-content">
            <span class="dc-func">${func}</span>
            <span style="color:var(--text-dim);"> · </span>
            <span class="dc-name">${name}</span>
            <span style="color:var(--text-dim);"> → </span>
            <span class="${cls}">${detail}</span>
        </span>`;
    decodedLogBody.appendChild(row);
    if (decodedAutoScroll) decodedLogBody.scrollTop = decodedLogBody.scrollHeight;
}

/* Scroll lock buttons */
const btnScrollFrame   = document.getElementById('btn-scroll-lock-frame');
const btnScrollDecoded = document.getElementById('btn-scroll-lock-decoded');

btnScrollFrame.addEventListener('click', () => {
    frameAutoScroll = !frameAutoScroll;
    btnScrollFrame.classList.toggle('active', frameAutoScroll);
    btnScrollFrame.textContent = frameAutoScroll ? '自动滚动' : '已锁定';
});
btnScrollDecoded.addEventListener('click', () => {
    decodedAutoScroll = !decodedAutoScroll;
    btnScrollDecoded.classList.toggle('active', decodedAutoScroll);
    btnScrollDecoded.textContent = decodedAutoScroll ? '自动滚动' : '已锁定';
});

/* Clear buttons */
document.getElementById('btn-clear-frame').addEventListener('click',   () => { frameLogBody.innerHTML   = ''; });
document.getElementById('btn-clear-decoded').addEventListener('click', () => { decodedLogBody.innerHTML = ''; });

/* ============================================================
   LEFT PANEL — collapse + drag resize
   ============================================================ */
const leftPanel       = document.getElementById('left-panel');
const leftSep         = document.getElementById('left-sep');
const btnCollapseLeft = document.getElementById('btn-collapse-left');
const btnExpandLeft   = document.getElementById('btn-expand-left');
let savedLeftWidth    = 280;

btnCollapseLeft.addEventListener('click', () => {
    savedLeftWidth = leftPanel.offsetWidth;
    leftPanel.classList.add('collapsed');
    leftSep.style.display    = 'none';
    btnExpandLeft.style.display = 'flex';
});

btnExpandLeft.addEventListener('click', () => {
    leftPanel.classList.remove('collapsed');
    leftPanel.style.width   = savedLeftWidth + 'px';
    leftSep.style.display   = '';
    btnExpandLeft.style.display = 'none';
});

leftSep.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX, startW = leftPanel.offsetWidth;
    const onMove = mv => {
        const w = Math.max(160, Math.min(520, startW + (mv.clientX - startX)));
        leftPanel.style.width = w + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

/* Left panel tabs */
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

/* Device node expand */
document.querySelectorAll('.device-node-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.device-node').classList.toggle('expanded'));
});

/* ============================================================
   BOTTOM PANEL — drag resize
   ============================================================ */
const bottomPanel  = document.getElementById('bottom-panel');
const bottomHandle = document.getElementById('bottom-resize-handle');

bottomHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY, startH = bottomPanel.offsetHeight;
    const onMove = mv => {
        const h = Math.max(80, Math.min(600, startH - (mv.clientY - startY)));
        bottomPanel.style.height = h + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

/* ============================================================
   CANVAS — drag-drop + widget factory
   ============================================================ */
const canvas     = document.getElementById('action-canvas');
const canvasHint = document.getElementById('canvas-hint');
let   gridSnap   = true;
let   dragWidgetType = null;

document.getElementById('btn-grid-snap').addEventListener('click', function () {
    gridSnap = !gridSnap;
    this.textContent = gridSnap ? '网格吸附 ✓' : '网格吸附';
});

document.getElementById('btn-clear-canvas').addEventListener('click', () => {
    canvas.querySelectorAll('.canvas-widget').forEach(w => w.remove());
    canvasHint.style.display = '';
});

const WIDGET_META = {
    waveform:    { icon: '📈', name: '波形图',          w: 380, h: 220 },
    attitude:    { icon: '🎲', name: '3D 姿态（Roll/Pitch/Yaw）', w: 280, h: 180 },
    gauge:       { icon: '🕹️', name: '仪表盘',          w: 200, h: 200 },
    number:      { icon: '#',  name: '数字显示',         w: 160, h: 120 },
    progressbar: { icon: '▬',  name: '进度条',           w: 260, h: 100 },
    xy:          { icon: '⊹',  name: 'XY 散点图',       w: 300, h: 260 },
    switch:      { icon: '🔘', name: '开关按键',         w: 180, h: 120 },
    slider:      { icon: '⇔',  name: '滑块',             w: 280, h: 100 },
    text:        { icon: 'T',  name: '文本标签',         w: 180, h: 90  },
    statuslight: { icon: '🔴', name: '状态灯',           w: 140, h: 110 },
    script:      { icon: '{}', name: 'JS 脚本解码器',   w: 360, h: 240 },
};

document.querySelectorAll('.widget-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', e => { dragWidgetType = card.dataset.type; e.dataTransfer.effectAllowed = 'copy'; });
    card.addEventListener('dragend',   () => { dragWidgetType = null; });
});

canvas.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });

canvas.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragWidgetType) return;
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (gridSnap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
    createWidget(dragWidgetType, x, y);
    dragWidgetType = null;
});

/* Action "+" adds widget */
document.querySelectorAll('.action-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const rect = canvas.getBoundingClientRect();
        createWidget('waveform', 24, 24);
    });
});

/* ── Widget factory ─────────────────────────────────────── */
function createWidget(type, x, y) {
    const meta = WIDGET_META[type];
    if (!meta) return;
    canvasHint.style.display = 'none';

    const el = document.createElement('div');
    el.className   = 'canvas-widget';
    el.style.left  = x + 'px';
    el.style.top   = y + 'px';
    el.style.width = meta.w + 'px';
    el.style.height = meta.h + 'px';
    el.dataset.type = type;

    el.innerHTML = `
        <div class="widget-titlebar">
            <span class="widget-titlebar-icon">${meta.icon}</span>
            <span class="widget-titlebar-name">${meta.name}</span>
            <button class="widget-close-btn" title="关闭">✕</button>
        </div>
        <div class="widget-body"></div>
        <div class="widget-resize"></div>`;

    canvas.appendChild(el);
    makeDraggable(el);
    makeResizable(el);

    el.querySelector('.widget-close-btn').addEventListener('click', () => {
        if (el._busUnsub) el._busUnsub();
        el.remove();
        if (!canvas.querySelector('.canvas-widget')) canvasHint.style.display = '';
    });

    el.addEventListener('mousedown', () => {
        document.querySelectorAll('.canvas-widget').forEach(w => w.classList.remove('selected'));
        el.classList.add('selected');
    });

    initWidgetContent(el, type);
    return el;
}

/* ── Widget content + live data ─────────────────────────── */
function initWidgetContent(el, type) {
    const body = el.querySelector('.widget-body');

    switch (type) {

    case 'waveform': {
        body.innerHTML = `
            <div class="wf-header">
                <select class="wf-src-sel" title="绑定数据源">
                    <option value="">— 未绑定 —</option>
                    <option value="0x0A:temp">0x0A 温度 (°C×100)</option>
                    <option value="0x0B:roll">0x0B Roll</option>
                    <option value="0x0B:pitch">0x0B Pitch</option>
                    <option value="0x0B:yaw">0x0B Yaw</option>
                    <option value="0x0C:adc">0x0C ADC 值</option>
                    <option value="0x0D:uptime">0x0D Uptime (s)</option>
                </select>
                <span class="wf-val">—</span>
            </div>
            <canvas class="wf-canvas"></canvas>`;
        const cvs  = body.querySelector('.wf-canvas');
        const sel  = body.querySelector('.wf-src-sel');
        const valEl = body.querySelector('.wf-val');
        const pts  = new Array(80).fill(null);
        let min = Infinity, max = -Infinity;
        let animId = null;

        function draw() {
            const W = cvs.offsetWidth, H = cvs.offsetHeight;
            cvs.width = W; cvs.height = H;
            const ctx = cvs.getContext('2d');
            ctx.clearRect(0, 0, W, H);

            const valid = pts.filter(v => v !== null);
            if (valid.length < 2) {
                ctx.fillStyle = 'var(--text-dim)';
                ctx.font = '11px var(--font-sans)';
                ctx.textAlign = 'center';
                ctx.fillText('等待数据…', W / 2, H / 2);
                return;
            }

            const lo = Math.min(...valid), hi = Math.max(...valid);
            const range = hi - lo || 1;
            const pad = 6;

            /* Grid lines */
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            [0.25, 0.5, 0.75].forEach(f => {
                ctx.beginPath();
                ctx.moveTo(0, pad + (1 - f) * (H - pad * 2));
                ctx.lineTo(W, pad + (1 - f) * (H - pad * 2));
                ctx.stroke();
            });

            /* Waveform */
            ctx.beginPath();
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
            ctx.lineWidth = 1.5;
            let first = true;
            pts.forEach((v, i) => {
                if (v === null) return;
                const px = (i / (pts.length - 1)) * W;
                const py = pad + (1 - (v - lo) / range) * (H - pad * 2);
                if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
            });
            ctx.stroke();

            /* Min/max labels */
            ctx.fillStyle = 'var(--text-dim)';
            ctx.font = '9px var(--font-mono)';
            ctx.textAlign = 'left';
            ctx.fillText(hi.toFixed(1), 2, pad + 7);
            ctx.fillText(lo.toFixed(1), 2, H - 3);
        }

        function pushValue(v) {
            pts.shift(); pts.push(v);
            valEl.textContent = v.toFixed(2);
            cancelAnimationFrame(animId);
            animId = requestAnimationFrame(draw);
        }

        function bindSource(key) {
            if (el._busUnsub) { el._busUnsub(); el._busUnsub = null; }
            if (!key) return;
            const [funcHex, field] = key.split(':');
            const func = parseInt(funcHex, 16);
            el._busUnsub = busOn(func, ({ data, stat }) => {
                if (stat & 0x10) return; // ignore TX frames
                let v = null;
                switch (field) {
                    case 'temp':   if (data.length >= 2) v = s16(data[0], data[1]) / 100; break;
                    case 'roll':   if (data.length >= 2) v = s16(data[0], data[1]) / 100; break;
                    case 'pitch':  if (data.length >= 4) v = s16(data[2], data[3]) / 100; break;
                    case 'yaw':    if (data.length >= 6) v = s16(data[4], data[5]) / 100; break;
                    case 'adc':    if (data.length >= 3) v = (data[1] << 8) | data[2];    break;
                    case 'uptime': if (data.length >= 4) v = ((data[0]<<24)|(data[1]<<16)|(data[2]<<8)|data[3]) / 1000; break;
                }
                if (v !== null) pushValue(v);
            });
        }

        sel.addEventListener('change', () => bindSource(sel.value));
        requestAnimationFrame(draw);
        break;
    }

    case 'attitude': {
        body.innerHTML = `
            <div class="att-vals">
                <div><span class="att-label">Roll</span><span class="att-num" id="att-roll">0.00°</span></div>
                <div><span class="att-label">Pitch</span><span class="att-num" id="att-pitch">0.00°</span></div>
                <div><span class="att-label">Yaw</span><span class="att-num" id="att-yaw">0.00°</span></div>
            </div>
            <div class="att-bar-group">
                <div class="att-bar-wrap"><div class="att-bar" id="att-bar-roll" style="width:50%"></div></div>
                <div class="att-bar-wrap"><div class="att-bar" id="att-bar-pitch" style="width:50%"></div></div>
                <div class="att-bar-wrap"><div class="att-bar" id="att-bar-yaw" style="width:50%"></div></div>
            </div>`;

        el._busUnsub = busOn(0x0B, ({ data, stat }) => {
            if (stat & 0x10 || data.length < 6) return;
            const r = s16(data[0], data[1]) / 100;
            const p = s16(data[2], data[3]) / 100;
            const y = s16(data[4], data[5]) / 100;
            const rEl = el.querySelector('#att-roll');
            const pEl = el.querySelector('#att-pitch');
            const yEl = el.querySelector('#att-yaw');
            if (rEl) rEl.textContent = r.toFixed(2) + '°';
            if (pEl) pEl.textContent = p.toFixed(2) + '°';
            if (yEl) yEl.textContent = y.toFixed(2) + '°';
            const rb = el.querySelector('#att-bar-roll');
            const pb = el.querySelector('#att-bar-pitch');
            const yb = el.querySelector('#att-bar-yaw');
            if (rb) rb.style.width = ((r / 360 + 0.5) * 100).toFixed(1) + '%';
            if (pb) pb.style.width = ((p / 180 + 0.5) * 100).toFixed(1) + '%';
            if (yb) yb.style.width = ((y / 360 + 0.5) * 100).toFixed(1) + '%';
        });
        break;
    }

    case 'gauge':
    case 'number': {
        body.innerHTML = `
            <div class="num-center">
                <div class="num-val">—</div>
                <div class="num-unit">
                    <select class="wf-src-sel num-src">
                        <option value="">— 未绑定 —</option>
                        <option value="0x0A:temp">0x0A 温度 (°C)</option>
                        <option value="0x0C:adc">0x0C ADC</option>
                        <option value="0x0D:tasks">0x0D Tasks</option>
                    </select>
                </div>
            </div>`;
        const valEl = body.querySelector('.num-val');
        const selEl = body.querySelector('.num-src');

        function bindNum(key) {
            if (el._busUnsub) { el._busUnsub(); el._busUnsub = null; }
            if (!key) return;
            const [funcHex, field] = key.split(':');
            const func = parseInt(funcHex, 16);
            el._busUnsub = busOn(func, ({ data, stat }) => {
                if (stat & 0x10) return;
                let v = null;
                switch (field) {
                    case 'temp':  if (data.length >= 2) v = (s16(data[0], data[1]) / 100).toFixed(2) + ' °C'; break;
                    case 'adc':   if (data.length >= 3) v = ((data[1] << 8) | data[2]).toString(); break;
                    case 'tasks': if (data.length >= 7) v = data[6].toString(); break;
                }
                if (v !== null) valEl.textContent = v;
            });
        }
        selEl.addEventListener('change', () => bindNum(selEl.value));
        break;
    }

    case 'progressbar': {
        body.innerHTML = `
            <div style="padding:0 4px;display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);">
                    <span>ADC ch0</span><span class="pb-text">— / 4095</span>
                </div>
                <div class="pb-track"><div class="pb-fill" style="width:0%"></div></div>
            </div>`;
        const fill = body.querySelector('.pb-fill');
        const txt  = body.querySelector('.pb-text');
        el._busUnsub = busOn(0x0C, ({ data, stat }) => {
            if (stat & 0x10 || data.length < 3 || data[0] !== 0) return;
            const v = (data[1] << 8) | data[2];
            fill.style.width   = (v / 4095 * 100).toFixed(1) + '%';
            txt.textContent    = `${v} / 4095`;
        });
        break;
    }

    case 'statuslight': {
        body.innerHTML = `
            <div class="sl-center">
                <div class="sl-dot"></div>
                <div class="sl-label">IDLE</div>
            </div>`;
        const dot   = body.querySelector('.sl-dot');
        const label = body.querySelector('.sl-label');
        el._busUnsub = busOn('*', ({ func, stat }) => {
            if (stat & 0x80) {
                dot.className = 'sl-dot sl-err'; label.textContent = 'ERROR';
            } else if (stat & 0x01) {
                dot.className = 'sl-dot sl-on';  label.textContent = `0x${func.toString(16).toUpperCase()}`;
            } else {
                dot.className = 'sl-dot sl-off'; label.textContent = 'IDLE';
            }
        });
        break;
    }

    case 'switch': {
        body.innerHTML = `
            <div class="sw-center">
                <div style="font-size:10px;color:var(--text-secondary);margin-bottom:8px;">LED Control 0x01</div>
                <div style="display:flex;gap:8px;">
                    <button class="sw-btn sw-on">ON</button>
                    <button class="sw-btn sw-off">OFF</button>
                </div>
                <div style="margin-top:8px;display:flex;gap:4px;">
                    <label style="font-size:10px;color:var(--text-dim);"><input type="checkbox" class="sw-led1" checked> LED1</label>
                    <label style="font-size:10px;color:var(--text-dim);"><input type="checkbox" class="sw-led2" checked> LED2</label>
                </div>
            </div>`;
        const addr   = () => parseInt(document.getElementById('target-addr').value, 16) || 1;
        const getLed1 = () => body.querySelector('.sw-led1').checked;
        const getLed2 = () => body.querySelector('.sw-led2').checked;
        const getMask = () => (getLed1() ? 1 : 0) | (getLed2() ? 2 : 0);

        body.querySelector('.sw-on').addEventListener('click', async () => {
            const fr = buildFrame(addr(), 0x01, 0x11, [getMask()]);
            appendFrameLog('tx', new Date(), fr.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '), 'LED ON');
            await serialSend(fr);
        });
        body.querySelector('.sw-off').addEventListener('click', async () => {
            const fr = buildFrame(addr(), 0x01, 0x10, []);
            appendFrameLog('tx', new Date(), fr.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '), 'LED OFF');
            await serialSend(fr);
        });
        break;
    }

    case 'slider': {
        body.innerHTML = `
            <div style="padding:0 4px;display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);">
                    <span>LED Blink interval</span><span class="sl-val-text">500ms</span>
                </div>
                <input type="range" min="1" max="10" value="5" class="sl-range">
            </div>`;
        const range  = body.querySelector('.sl-range');
        const valTxt = body.querySelector('.sl-val-text');
        const addr   = () => parseInt(document.getElementById('target-addr').value, 16) || 1;
        range.addEventListener('input', () => {
            valTxt.textContent = (range.value * 100) + 'ms';
        });
        range.addEventListener('change', async () => {
            const mask = 0x03, interval = parseInt(range.value);
            const fr = buildFrame(addr(), 0x02, 0x11, [mask, interval]);
            appendFrameLog('tx', new Date(), fr.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '), 'LED Blink');
            await serialSend(fr);
        });
        break;
    }

    case 'text': {
        body.innerHTML = `<div class="text-body">— 无数据 —</div>`;
        el._busUnsub = busOn(0x20, ({ data, stat }) => {
            if (stat & 0x10) return;
            const ascii = String.fromCharCode(...data.filter(b => b >= 0x20 && b < 0x7F));
            body.querySelector('.text-body').textContent = ascii || `[${data.length}B]`;
        });
        break;
    }

    case 'xy':
    case 'script':
    default:
        body.innerHTML = `<div style="color:var(--text-dim);font-size:11px;padding:8px;text-align:center;">${type}</div>`;
    }
}

/* ── Widget drag + resize ─────────────────────────────── */
function makeDraggable(el) {
    const handle = el.querySelector('.widget-titlebar');
    handle.addEventListener('mousedown', e => {
        if (e.target.classList.contains('widget-close-btn')) return;
        e.preventDefault();
        const ox = el.offsetLeft, oy = el.offsetTop;
        const sx = e.clientX,     sy = e.clientY;
        const onMove = mv => {
            let x = ox + (mv.clientX - sx), y = oy + (mv.clientY - sy);
            if (gridSnap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
            el.style.left = Math.max(0, x) + 'px';
            el.style.top  = Math.max(0, y) + 'px';
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function makeResizable(el) {
    const handle = el.querySelector('.widget-resize');
    handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const sw = el.offsetWidth, sh = el.offsetHeight, sx = e.clientX, sy = e.clientY;
        const onMove = mv => {
            el.style.width  = Math.max(140, sw + (mv.clientX - sx)) + 'px';
            el.style.height = Math.max(90,  sh + (mv.clientY - sy)) + 'px';
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

/* ============================================================
   SETTINGS — themes
   ============================================================ */
const THEMES = {
    'dark-blue':   { '--bg-base':'#0d1117','--bg-panel':'#161b22','--bg-widget':'#1c2230','--bg-input':'#0d1117','--bg-canvas':'#111827','--bg-hover':'#21262d','--border':'#30363d','--border-focus':'#3b82f6','--accent':'#3b82f6','--accent-hover':'#2563eb','--accent-dim':'rgba(59,130,246,0.15)' },
    'dark-purple': { '--bg-base':'#0e0b1a','--bg-panel':'#14112a','--bg-widget':'#1a1738','--bg-input':'#0e0b1a','--bg-canvas':'#100e1f','--bg-hover':'#1e1a40','--border':'#2d2850','--border-focus':'#8b5cf6','--accent':'#8b5cf6','--accent-hover':'#7c3aed','--accent-dim':'rgba(139,92,246,0.15)' },
    'dark-cyan':   { '--bg-base':'#091214','--bg-panel':'#0e1e22','--bg-widget':'#132830','--bg-input':'#091214','--bg-canvas':'#0b1618','--bg-hover':'#173038','--border':'#1e3840','--border-focus':'#06b6d4','--accent':'#06b6d4','--accent-hover':'#0891b2','--accent-dim':'rgba(6,182,212,0.15)' },
    'dark-green':  { '--bg-base':'#091210','--bg-panel':'#0e1e1a','--bg-widget':'#132820','--bg-input':'#091210','--bg-canvas':'#0b1512','--bg-hover':'#173025','--border':'#1e3828','--border-focus':'#10b981','--accent':'#10b981','--accent-hover':'#059669','--accent-dim':'rgba(16,185,129,0.15)' },
    'dark-orange': { '--bg-base':'#130e08','--bg-panel':'#1e1610','--bg-widget':'#281d14','--bg-input':'#130e08','--bg-canvas':'#150f08','--bg-hover':'#302010','--border':'#3d2d18','--border-focus':'#f97316','--accent':'#f97316','--accent-hover':'#ea6a00','--accent-dim':'rgba(249,115,22,0.15)' },
    'chinese-red': { '--bg-base':'#120808','--bg-panel':'#1e0e0e','--bg-widget':'#280f0f','--bg-input':'#120808','--bg-canvas':'#140909','--bg-hover':'#301010','--border':'#3d1515','--border-focus':'#c0272d','--accent':'#c0272d','--accent-hover':'#a01f24','--accent-dim':'rgba(192,39,45,0.15)' },
    'dark-amber':  { '--bg-base':'#130f06','--bg-panel':'#1e180a','--bg-widget':'#28200e','--bg-input':'#130f06','--bg-canvas':'#15110a','--bg-hover':'#302810','--border':'#3d3015','--border-focus':'#f59e0b','--accent':'#f59e0b','--accent-hover':'#d97706','--accent-dim':'rgba(245,158,11,0.15)' },
    'pitch-black': { '--bg-base':'#060608','--bg-panel':'#0c0c12','--bg-widget':'#111118','--bg-input':'#060608','--bg-canvas':'#080809','--bg-hover':'#16161f','--border':'#1e1e2a','--border-focus':'#4d7cfe','--accent':'#4d7cfe','--accent-hover':'#3a5fd4','--accent-dim':'rgba(77,124,254,0.15)' },
};

function applyTheme(key) {
    const t = THEMES[key]; if (!t) return;
    Object.entries(t).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}
function setActiveThemeItem(key) {
    document.querySelectorAll('.theme-item').forEach(el => el.classList.toggle('active', el.dataset.theme === key));
}

document.querySelectorAll('.theme-item').forEach(item => {
    item.addEventListener('click', () => {
        applyTheme(item.dataset.theme);
        setActiveThemeItem(item.dataset.theme);
        localStorage.setItem('ab-theme', item.dataset.theme);
    });
});

const settingsPanel = document.getElementById('settings-panel');
document.getElementById('btn-settings').addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.classList.toggle('hidden');
});
document.addEventListener('click', e => {
    if (!settingsPanel.contains(e.target) && e.target !== document.getElementById('btn-settings'))
        settingsPanel.classList.add('hidden');
});

/* ── Load theme + init ───────────────────────────────────── */
(function init() {
    const saved = localStorage.getItem('ab-theme') || 'dark-blue';
    applyTheme(saved);
    setActiveThemeItem(saved);
    refreshPortList();
})();
