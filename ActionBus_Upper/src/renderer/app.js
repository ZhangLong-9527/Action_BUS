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

/** Known ActionBus function codes — display name */
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

/* ============================================================
   RING BUFFER  (fixed-capacity, O(1) push, ordered read)
   ============================================================ */
class RingBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buf      = new Float64Array(capacity);
        this.head     = 0;   // next write index
        this.size     = 0;   // valid entries
    }
    push(v) {
        this.buf[this.head] = v;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }
    /** i=0 → oldest, i=size-1 → newest */
    get(i) {
        return this.buf[(this.head - this.size + i + this.capacity * 2) % this.capacity];
    }
    toArray() {
        const a = new Float64Array(this.size);
        for (let i = 0; i < this.size; i++) a[i] = this.get(i);
        return a;
    }
    resize(newCap) {
        const data = this.toArray();
        this.capacity = newCap;
        this.buf  = new Float64Array(newCap);
        this.head = 0; this.size = 0;
        const start = Math.max(0, data.length - newCap);
        for (let i = start; i < data.length; i++) this.push(data[i]);
    }
    clear() { this.head = 0; this.size = 0; }
}

/* ============================================================
   WIDGET STATE  (configs + live APIs)
   ============================================================ */

/** widgetId → { script?, onFrame?, offFrame?, maxPoints?, label? } */
const widgetConfigs = new Map();

/** widgetId → { pushChannel(n, v, opts), getChannels(), ... } */
const widgetAPI = new Map();

/** Currently selected widget element */
let selectedWidget = null;

let _widgetCounter = 0;
function nextWidgetId() { return `w${++_widgetCounter}`; }

/* Palette of default channel colors (cycles for ch > 7) */
const CH_COLORS = [
    '#3b82f6','#f97316','#10b981','#f59e0b',
    '#8b5cf6','#06b6d4','#ef4444','#84cc16',
];
function chColor(n) { return CH_COLORS[n % CH_COLORS.length]; }

/* ============================================================
   DEVICE REGISTRY + DYNAMIC DEVICE LIST
   ============================================================ */

/** addr (number) → { addr, name, uptime, cpuTemp, tasks, online } */
const deviceRegistry = new Map();

/** Pending frame-response promises: `${addr}_${func}` → resolve fn */
const pendingQueries = {};

function resolveQuery(addr, func, payload) {
    const key = `${addr}_${func}`;
    if (pendingQueries[key]) {
        pendingQueries[key](payload);
        delete pendingQueries[key];
    }
}

function waitForResponse(addr, func, timeoutMs = 600) {
    return new Promise(resolve => {
        const key = `${addr}_${func}`;
        pendingQueries[key] = resolve;
        setTimeout(() => {
            if (pendingQueries[key] === resolve) {
                delete pendingQueries[key];
                resolve(null);
            }
        }, timeoutMs);
    });
}

function addrHex(addr) {
    return '0x' + addr.toString(16).padStart(2, '0').toUpperCase();
}

function renderDeviceList() {
    const list = document.getElementById('device-list');
    if (!list) return;

    if (deviceRegistry.size === 0) {
        list.innerHTML = '<div class="device-list-empty">暂无设备<br><span>连接串口后点击「刷新」或「One Click Scan」</span></div>';
        return;
    }

    list.innerHTML = '';
    for (const [addr, dev] of deviceRegistry) {
        const hex     = addrHex(addr);
        const isOnline = dev.online;
        const statusCls = dev.pending ? 'pending' : (isOnline ? '' : 'offline');
        const nodeCls   = isOnline ? '' : ' offline';

        const funcList = Object.entries(AB_FUNC)
            .filter(([code]) => +code !== 0xF0 && +code !== 0xFE)
            .map(([code, name]) => {
                const fc = (+code).toString(16).padStart(2,'0').toUpperCase();
                return `<div class="action-item">
                    <span class="action-code">0x${fc}</span>
                    <span class="action-name">${name}</span>
                </div>`;
            }).join('');

        const upStr = dev.uptime !== undefined
            ? `uptime ${(dev.uptime / 1000).toFixed(0)}s  cpu ${(dev.cpuTemp / 100).toFixed(1)}°C  tasks ${dev.tasks}`
            : '';

        const node = document.createElement('div');
        node.className = `device-node${nodeCls}`;
        node.dataset.addr = addr;
        node.innerHTML = `
            <div class="device-node-header">
                <span class="device-chevron">▶</span>
                <span class="device-addr">${hex}</span>
                <div class="device-info">
                    <div class="device-name">${dev.name || 'ActionBus Node'}</div>
                    <div class="device-ver">${upStr || (isOnline ? 'v3.1 · ActionBus' : '离线')}</div>
                </div>
                <span class="device-status ${statusCls}"></span>
            </div>
            <div class="device-actions">${funcList}</div>`;
        list.appendChild(node);
    }
}

function onDeviceStatusReceived(addr, data) {
    if (data.length < 8) return;
    const uptime  = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
    const cpuTemp = s16(data[4], data[5]);
    const tasks   = data[6];
    const devAddr = data[7];
    const existing = deviceRegistry.get(addr) || {};
    deviceRegistry.set(addr, {
        ...existing,
        addr,
        name:    existing.name || `Node_${addrHex(devAddr)}`,
        uptime,
        cpuTemp,
        tasks,
        online:  true,
        pending: false,
    });
    renderDeviceList();
}

async function queryDevice(addr) {
    if (!connected) return;
    const existing = deviceRegistry.get(addr) || {};
    deviceRegistry.set(addr, { ...existing, addr, online: false, pending: true });
    renderDeviceList();

    const frame = buildFrame(addr, 0x0D, 0x11);
    const hexStr = frame.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    appendFrameLog('tx', new Date(), hexStr, 'Device Status');
    await serialSend(frame);

    const resp = await waitForResponse(addr, 0x0D, 700);
    if (resp) {
        onDeviceStatusReceived(addr, resp.data);
    } else {
        const dev = deviceRegistry.get(addr);
        if (dev) { dev.online = false; dev.pending = false; }
        renderDeviceList();
        appendDecodedLog('info', new Date(), '—', 'System', `${addrHex(addr)} 无响应`, 'err');
    }
}

async function scanDevices() {
    if (!connected) {
        appendDecodedLog('info', new Date(), '—', 'System', '请先连接串口', 'err');
        return;
    }
    appendDecodedLog('info', new Date(), '—', 'System', '扫描总线 0x01–0x10…', 'val');

    const list = document.getElementById('device-list');
    list.innerHTML = '<div class="device-scan-row"><div class="scan-spinner"></div>正在扫描 0x01 – 0x10…</div>';

    for (let addr = 0x01; addr <= 0x10; addr++) {
        const frame  = buildFrame(addr, 0x0D, 0x11);
        await serialSend(frame);
        const resp = await waitForResponse(addr, 0x0D, 250);
        if (resp) onDeviceStatusReceived(addr, resp.data);
    }

    if (deviceRegistry.size === 0) {
        renderDeviceList();
        appendDecodedLog('info', new Date(), '—', 'System', '未发现设备', 'err');
    } else {
        renderDeviceList();
        appendDecodedLog('info', new Date(), '—', 'System', `发现 ${deviceRegistry.size} 台设备`, 'ok');
    }
}

/* Event delegation on device list — expand/collapse only */
document.getElementById('device-list').addEventListener('click', e => {
    const header = e.target.closest('.device-node-header');
    if (header) header.closest('.device-node').classList.toggle('expanded');
});

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
        /* Mark all devices offline */
        for (const dev of deviceRegistry.values()) { dev.online = false; dev.pending = false; }
        renderDeviceList();
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

        /* Resolve any pending await-response query */
        resolveQuery(addr, func, { addr, func, stat, data });

        /* Drive display-widget scripts */
        runDisplayScripts({ func, stat, addr, data });

        /* Notify canvas widgets (legacy bus) */
        busEmit(func, { func, stat, addr, data });
    }
}

/* ============================================================
   DISPLAY SCRIPT RUNNER
   ============================================================ */
function runDisplayScripts(frame) {
    const frameObj = {
        func: frame.func, stat: frame.stat, addr: frame.addr,
        data: new Uint8Array(frame.data),
    };
    const { data } = frameObj;
    const dv = () => new DataView(data.buffer, data.byteOffset);
    const safe = (fn) => { try { return fn(); } catch { return 0; } };
    const readFloat32BE = o => safe(() => dv().getFloat32(o, false));
    const readFloat32LE = o => safe(() => dv().getFloat32(o, true));
    const readInt16BE   = o => safe(() => dv().getInt16(o, false));
    const readInt16LE   = o => safe(() => dv().getInt16(o, true));
    const readUint16BE  = o => safe(() => dv().getUint16(o, false));
    const readUint16LE  = o => safe(() => dv().getUint16(o, true));
    const readUint32BE  = o => safe(() => dv().getUint32(o, false));
    const readInt32BE   = o => safe(() => dv().getInt32(o, false));

    document.querySelectorAll('.canvas-widget').forEach(widgetEl => {
        const cfg = widgetConfigs.get(widgetEl.id);
        if (!cfg || !cfg.script || !cfg.script.trim()) return;
        const api = widgetAPI.get(widgetEl.id);
        if (!api || !api.pushChannel) return;

        function ch(n) {
            return { push: (v, opts = {}) => api.pushChannel(n, v, opts) };
        }
        function output(v) { ch(0).push(v); }

        try {
            /* eslint-disable no-new-func */
            const fn = new Function(
                'frame','ch','output',
                'readFloat32BE','readFloat32LE',
                'readInt16BE','readInt16LE',
                'readUint16BE','readUint16LE',
                'readUint32BE','readInt32BE',
                cfg.script
            );
            fn(frameObj, ch, output,
               readFloat32BE, readFloat32LE,
               readInt16BE, readInt16LE,
               readUint16BE, readUint16LE,
               readUint32BE, readInt32BE);
            clearWidgetScriptError(widgetEl);
        } catch (e) {
            showWidgetScriptError(widgetEl, e.message);
            appendDecodedLog('info', new Date(), '—', 'ScriptErr', e.message, 'err');
        }
    });
}

function showWidgetScriptError(el, msg) {
    let banner = el.querySelector('.widget-script-err');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'widget-script-err';
        el.appendChild(banner);
    }
    banner.textContent = msg;
    banner.classList.add('visible');
    /* Also show in right panel if this widget is selected */
    if (selectedWidget === el) {
        const rErr = document.getElementById('rpanel-script-error');
        if (rErr) { rErr.textContent = msg; rErr.classList.add('visible'); }
    }
}

function clearWidgetScriptError(el) {
    const banner = el.querySelector('.widget-script-err');
    if (banner) banner.classList.remove('visible');
    if (selectedWidget === el) {
        const rErr = document.getElementById('rpanel-script-error');
        if (rErr) rErr.classList.remove('visible');
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
   ONE-CLICK SCAN  (titlebar) + REFRESH (sidebar)
   ============================================================ */
document.getElementById('btn-scan').addEventListener('click', () => scanDevices());

document.getElementById('btn-refresh-devices').addEventListener('click', () => {
    if (!connected) { appendDecodedLog('info', new Date(), '—', 'System', '请先连接串口', 'err'); return; }
    const addr = parseInt(document.getElementById('target-addr').value.trim(), 16) || 0x01;
    queryDevice(addr);
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


/* ============================================================
   RIGHT PANEL — properties + script editor
   ============================================================ */
const rightPanel  = document.getElementById('right-panel');
const rightSep    = document.getElementById('right-sep');
const rpanelBody  = document.getElementById('rpanel-body');
const rpanelType  = document.getElementById('rpanel-widget-type');

document.getElementById('rpanel-close').addEventListener('click', () => hideRightPanel());

/* Right sep drag */
rightSep.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX, startW = rightPanel.offsetWidth;
    const onMove = mv => {
        const w = Math.max(200, Math.min(520, startW - (mv.clientX - startX)));
        rightPanel.style.width = w + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

function showRightPanel(widgetEl) {
    selectedWidget = widgetEl;
    rightPanel.style.display = 'flex';
    rightSep.style.display   = '';
    const meta = WIDGET_META[widgetEl.dataset.type] || {};
    rpanelType.textContent = meta.name || widgetEl.dataset.type;
    populateRightPanel(widgetEl);
}

function hideRightPanel() {
    selectedWidget = null;
    rightPanel.style.display = 'none';
    rightSep.style.display   = 'none';
    rpanelBody.innerHTML     = '';
}

const CONTROL_TYPES = new Set(['switch', 'slider']);
const DISPLAY_TYPES = new Set(['waveform','attitude','gauge','number','progressbar','xy','statuslight','text','script']);

const FUNC_OPTIONS = Object.entries(AB_FUNC)
    .filter(([c]) => +c < 0xF0)
    .map(([c, n]) => `<option value="${+c}">0x${(+c).toString(16).padStart(2,'0').toUpperCase()} ${n}</option>`)
    .join('');

function populateRightPanel(el) {
    const cfg  = widgetConfigs.get(el.id) || {};
    const type = el.dataset.type;
    rpanelBody.innerHTML = '';

    /* ── Label row ── */
    const labelRow = document.createElement('div');
    labelRow.className = 'rp-section';
    const nameEl = el.querySelector('.widget-titlebar-name');
    labelRow.innerHTML = `
        <div class="rp-section-title">标签</div>
        <div class="rp-row">
            <input class="rp-input" id="rp-label" value="${nameEl?.textContent || ''}">
        </div>`;
    rpanelBody.appendChild(labelRow);
    document.getElementById('rp-label').addEventListener('input', function() {
        if (nameEl) nameEl.textContent = this.value;
        (widgetConfigs.get(el.id) || {}).label = this.value;
    });

    if (CONTROL_TYPES.has(type)) {
        populateControlPanel(el, cfg, type);
    } else if (DISPLAY_TYPES.has(type)) {
        populateScriptPanel(el, cfg);
    }

    /* ── waveform extras ── */
    if (type === 'waveform') populateWaveformExtras(el, cfg);
}

function frameConfigSection(el, cfg, key, title, defaultStat) {
    const fc = (cfg[key] || {});
    const sec = document.createElement('div');
    sec.className = 'rp-section';
    const funcVal = fc.func != null ? fc.func : '';
    const statVal = fc.stat != null ? fc.stat.toString(16) : defaultStat;
    const dataVal = (fc.data || []).map(b => b.toString(16).padStart(2,'0')).join(' ');
    sec.innerHTML = `
        <div class="rp-section-title">${title}</div>
        <div class="rp-row">
            <span class="rp-label">Func</span>
            <select class="rp-select rp-func-${key}">
                <option value="">— 选择 —</option>
                ${FUNC_OPTIONS}
            </select>
        </div>
        <div class="rp-row">
            <span class="rp-label">Func手填</span>
            <input class="rp-input rp-func-custom-${key}" placeholder="0x0D" value="${funcVal !== '' ? '0x'+funcVal.toString(16) : ''}">
        </div>
        <div class="rp-row">
            <span class="rp-label">Stat</span>
            <input class="rp-input rp-stat-${key}" value="${statVal}" style="width:44px;flex:none">
        </div>
        <div class="rp-row">
            <span class="rp-label">Data</span>
            <input class="rp-input rp-data-${key}" placeholder="hex bytes, 空格分隔" value="${dataVal}">
        </div>`;

    const selEl    = sec.querySelector(`.rp-func-${key}`);
    const customEl = sec.querySelector(`.rp-func-custom-${key}`);
    const statEl   = sec.querySelector(`.rp-stat-${key}`);
    const dataEl   = sec.querySelector(`.rp-data-${key}`);

    if (funcVal !== '') selEl.value = funcVal;

    function save() {
        const rawFunc = customEl.value.trim();
        const funcNum = rawFunc ? parseInt(rawFunc.replace(/^0x/i,''), 16)
                                : parseInt(selEl.value, 10);
        const stat = parseInt(statEl.value.replace(/^0x/i,''), 16);
        const data = parseHexStr(dataEl.value);
        const conf = widgetConfigs.get(el.id) || {};
        conf[key] = { func: funcNum, stat: isNaN(stat) ? (defaultStat === '11' ? 0x11 : 0x10) : stat, data };
        widgetConfigs.set(el.id, conf);
    }
    [selEl, customEl, statEl, dataEl].forEach(i => i.addEventListener('change', save));
    return sec;
}

function populateControlPanel(el, cfg, type) {
    rpanelBody.appendChild(frameConfigSection(el, cfg, 'onFrame',  'ON 帧',  '11'));
    rpanelBody.appendChild(frameConfigSection(el, cfg, 'offFrame', 'OFF 帧', '10'));
}

function populateScriptPanel(el, cfg) {
    const sec = document.createElement('div');
    sec.className = 'rp-section';
    const scriptText = cfg.script || '';
    sec.innerHTML = `
        <div class="rp-section-title">绑定脚本</div>
        <div class="rp-script-toolbar">
            <span class="rp-label" style="width:auto;flex:1;font-size:10px;color:var(--text-dim)">每帧触发一次</span>
            <button class="rp-btn" id="rp-import-script">导入 JS</button>
            <button class="rp-btn primary" id="rp-apply-script">应用</button>
        </div>
        <textarea class="rp-script-area" id="rp-script-area" spellcheck="false">${scriptText}</textarea>
        <div class="rp-script-error" id="rpanel-script-error"></div>
        <div class="rp-api-hint">
frame.func / .stat / .addr / .data (Uint8Array)<br>
ch(n).push(value, {color?, lineWidth?, label?})<br>
output(v)  →  ch(0).push(v)<br>
readFloat32BE/LE(offset)<br>
readInt16BE/LE(offset)<br>
readUint16BE/LE(offset)<br>
readUint32BE/LE(offset) / readInt32BE(offset)
        </div>`;
    rpanelBody.appendChild(sec);

    document.getElementById('rp-apply-script').addEventListener('click', () => {
        const code = document.getElementById('rp-script-area').value;
        const conf = widgetConfigs.get(el.id) || {};
        conf.script = code;
        widgetConfigs.set(el.id, conf);
        clearWidgetScriptError(el);
        const rErr = document.getElementById('rpanel-script-error');
        if (rErr) rErr.classList.remove('visible');
    });

    document.getElementById('rp-import-script').addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.js,.txt';
        inp.addEventListener('change', () => {
            const f = inp.files[0]; if (!f) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const area = document.getElementById('rp-script-area');
                if (area) area.value = ev.target.result;
            };
            reader.readAsText(f);
        });
        inp.click();
    });
}

function populateWaveformExtras(el, cfg) {
    const api = widgetAPI.get(el.id);
    const sec = document.createElement('div');
    sec.className = 'rp-section';
    const pts = cfg.maxPoints || 1000;
    sec.innerHTML = `
        <div class="rp-section-title">波形图设置</div>
        <div class="rp-row">
            <span class="rp-label">历史点数</span>
            <select class="rp-select" id="rp-maxpoints">
                ${[50,200,500,1000,2000,5000].map(v =>
                    `<option value="${v}"${v===pts?' selected':''}>${v} pts</option>`).join('')}
            </select>
        </div>
        <div class="rp-row" style="margin-top:2px">
            <button class="rp-btn" id="rp-clear-wf">清空数据</button>
            <button class="rp-btn primary" id="rp-export-csv">↓ 导出 CSV</button>
        </div>`;
    rpanelBody.appendChild(sec);

    document.getElementById('rp-maxpoints').addEventListener('change', function() {
        const n = parseInt(this.value);
        const conf = widgetConfigs.get(el.id) || {};
        conf.maxPoints = n;
        widgetConfigs.set(el.id, conf);
        if (api && api.setMaxPoints) api.setMaxPoints(n);
    });

    document.getElementById('rp-clear-wf').addEventListener('click', () => {
        if (api && api.clearChannels) api.clearChannels();
    });

    document.getElementById('rp-export-csv').addEventListener('click', () => {
        if (api && api.exportCSV) api.exportCSV();
    });
}

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
    canvas.querySelectorAll('.canvas-widget').forEach(w => {
        widgetConfigs.delete(w.id);
        widgetAPI.delete(w.id);
        w.remove();
    });
    hideRightPanel();
    canvasHint.style.display = '';
});

/* Click on canvas background deselects widget + hides right panel */
canvas.addEventListener('mousedown', e => {
    if (e.target === canvas || e.target === canvasHint) {
        canvas.querySelectorAll('.canvas-widget').forEach(w => w.classList.remove('selected'));
        hideRightPanel();
    }
});

/* ── Save / Load layout ── */
document.getElementById('btn-save-layout').addEventListener('click', () => {
    const widgets = [];
    canvas.querySelectorAll('.canvas-widget').forEach(w => {
        const cfg  = widgetConfigs.get(w.id) || {};
        const name = w.querySelector('.widget-titlebar-name')?.textContent || '';
        widgets.push({
            type: w.dataset.type,
            x: parseInt(w.style.left), y: parseInt(w.style.top),
            w: w.offsetWidth,          h: w.offsetHeight,
            label: name,
            ...cfg,
        });
    });
    const json = JSON.stringify({ version: 1, widgets }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'layout.json' });
    a.click(); URL.revokeObjectURL(url);
});

document.getElementById('btn-load-layout').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.addEventListener('change', () => {
        const f = inp.files[0]; if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const { widgets } = JSON.parse(ev.target.result);
                canvas.querySelectorAll('.canvas-widget').forEach(w => {
                    widgetConfigs.delete(w.id); widgetAPI.delete(w.id); w.remove();
                });
                hideRightPanel();
                canvasHint.style.display = '';
                widgets.forEach(wd => {
                    const el = createWidget(wd.type, wd.x, wd.y);
                    if (!el) return;
                    el.style.width  = wd.w + 'px';
                    el.style.height = wd.h + 'px';
                    if (wd.label) {
                        const n = el.querySelector('.widget-titlebar-name');
                        if (n) n.textContent = wd.label;
                    }
                    const conf = {};
                    if (wd.script    !== undefined) conf.script    = wd.script;
                    if (wd.onFrame   !== undefined) conf.onFrame   = wd.onFrame;
                    if (wd.offFrame  !== undefined) conf.offFrame  = wd.offFrame;
                    if (wd.maxPoints !== undefined) conf.maxPoints = wd.maxPoints;
                    widgetConfigs.set(el.id, conf);
                    /* Apply maxPoints to waveform ring buffers */
                    if (wd.type === 'waveform' && wd.maxPoints) {
                        const api = widgetAPI.get(el.id);
                        if (api && api.setMaxPoints) api.setMaxPoints(wd.maxPoints);
                    }
                });
                if (canvas.querySelector('.canvas-widget')) canvasHint.style.display = 'none';
            } catch (e) {
                appendDecodedLog('info', new Date(), '—', 'System', `布局加载失败: ${e.message}`, 'err');
            }
        };
        reader.readAsText(f);
    });
    inp.click();
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


/* ── Widget factory ─────────────────────────────────────── */
function createWidget(type, x, y, existingId) {
    const meta = WIDGET_META[type];
    if (!meta) return null;
    canvasHint.style.display = 'none';

    const el = document.createElement('div');
    el.id          = existingId || nextWidgetId();
    el.className   = 'canvas-widget';
    el.style.left  = x + 'px';
    el.style.top   = y + 'px';
    el.style.width = meta.w + 'px';
    el.style.height = meta.h + 'px';
    el.dataset.type = type;

    const csvBtn = type === 'waveform'
        ? `<button class="widget-csv-btn" title="导出 CSV">↓</button>` : '';

    el.innerHTML = `
        <div class="widget-titlebar">
            <span class="widget-titlebar-icon">${meta.icon}</span>
            <span class="widget-titlebar-name">${meta.name}</span>
            ${csvBtn}
            <button class="widget-close-btn" title="关闭">✕</button>
        </div>
        <div class="widget-body"></div>
        <div class="widget-resize"></div>`;

    canvas.appendChild(el);
    makeDraggable(el);
    makeResizable(el);

    if (!widgetConfigs.has(el.id)) widgetConfigs.set(el.id, {});

    el.querySelector('.widget-close-btn').addEventListener('click', e => {
        e.stopPropagation();
        if (el._busUnsub) el._busUnsub();
        widgetConfigs.delete(el.id);
        widgetAPI.delete(el.id);
        if (selectedWidget === el) hideRightPanel();
        el.remove();
        if (!canvas.querySelector('.canvas-widget')) canvasHint.style.display = '';
    });

    const csvBtnEl = el.querySelector('.widget-csv-btn');
    if (csvBtnEl) csvBtnEl.addEventListener('click', e => {
        e.stopPropagation();
        const api = widgetAPI.get(el.id);
        if (api && api.exportCSV) api.exportCSV();
    });

    el.addEventListener('mousedown', e => {
        if (e.target.classList.contains('widget-close-btn') ||
            e.target.classList.contains('widget-csv-btn')) return;
        document.querySelectorAll('.canvas-widget').forEach(w => w.classList.remove('selected'));
        el.classList.add('selected');
        showRightPanel(el);
    });

    initWidgetContent(el, type);
    return el;
}

/* ── Widget content + live data ─────────────────────────── */
function initWidgetContent(el, type) {
    const body = el.querySelector('.widget-body');

    switch (type) {

    case 'waveform': {
        const MAX_CH   = 32;
        const initCap  = (widgetConfigs.get(el.id) || {}).maxPoints || 1000;

        /* Per-channel state */
        const channels = Array.from({ length: MAX_CH }, (_, i) => ({
            ring:      new RingBuffer(initCap),
            color:     chColor(i),
            lineWidth: 1.5,
            label:     '',
            active:    false,
        }));

        /* Viewport state */
        let xView  = initCap;   /* how many points to show on x-axis */
        let yMode  = 'auto';    /* 'auto' | 'manual' */
        let yCenter = 0, yRange = 2;

        body.innerHTML = `<canvas class="wf-canvas" style="width:100%;height:100%;display:block"></canvas>`;
        const cvs = body.querySelector('.wf-canvas');
        const ctx = cvs.getContext('2d');

        let dirty = false;
        let rafId = null;

        function scheduleDraw() {
            if (!rafId) rafId = requestAnimationFrame(() => {
                rafId = null;
                if (dirty) { draw(); dirty = false; }
            });
        }

        function draw() {
            const W = cvs.offsetWidth, H = cvs.offsetHeight;
            if (W === 0 || H === 0) return;
            cvs.width = W; cvs.height = H;
            ctx.clearRect(0, 0, W, H);

            const active = channels.filter(c => c.active && c.ring.size > 0);
            if (active.length === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.font = '11px var(--font-mono)';
                ctx.textAlign = 'center';
                ctx.fillText('等待数据 — 在右侧属性面板绑定脚本', W / 2, H / 2);
                return;
            }

            /* Y range */
            let yLo, yHi;
            if (yMode === 'manual') {
                yLo = yCenter - yRange / 2;
                yHi = yCenter + yRange / 2;
            } else {
                yLo = Infinity; yHi = -Infinity;
                for (const c of active) {
                    const n = Math.min(c.ring.size, xView);
                    for (let i = c.ring.size - n; i < c.ring.size; i++) {
                        const v = c.ring.get(i);
                        if (v < yLo) yLo = v;
                        if (v > yHi) yHi = v;
                    }
                }
                if (yLo === yHi) { yLo -= 1; yHi += 1; }
            }
            const ySpan = yHi - yLo || 1;
            const pad = { t: 18, b: 18, l: 44, r: 8 };
            const W2  = W - pad.l - pad.r;
            const H2  = H - pad.t - pad.b;

            /* Grid */
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            [0, 0.25, 0.5, 0.75, 1].forEach(f => {
                const y = pad.t + f * H2;
                ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
                const val = yHi - f * ySpan;
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '8px var(--font-mono)';
                ctx.textAlign = 'right';
                ctx.fillText(val.toFixed(2), pad.l - 2, y + 3);
            });

            /* Channels */
            for (const c of active) {
                const n = Math.min(c.ring.size, xView);
                if (n < 2) continue;
                ctx.beginPath();
                ctx.strokeStyle = c.color;
                ctx.lineWidth   = c.lineWidth;
                for (let i = 0; i < n; i++) {
                    const v  = c.ring.get(c.ring.size - n + i);
                    const px = pad.l + (i / (xView - 1)) * W2;
                    const py = pad.t + (1 - (v - yLo) / ySpan) * H2;
                    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                }
                ctx.stroke();
            }

            /* Legend */
            let lx = pad.l + 4;
            for (const c of active) {
                ctx.fillStyle = c.color;
                ctx.font = '9px var(--font-mono)';
                ctx.textAlign = 'left';
                const label = c.label || `ch${channels.indexOf(c)}`;
                ctx.fillText('■ ' + label, lx, pad.t - 4);
                lx += ctx.measureText('■ ' + label).width + 8;
                if (lx > W - 60) break;
            }
        }

        /* Zoom: wheel = X, Ctrl+wheel = Y */
        cvs.addEventListener('wheel', e => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.2 : 0.8;
            if (e.ctrlKey) {
                yMode = 'manual';
                /* compute current center from auto if switching */
                if (yMode !== 'manual') {
                    yCenter = (channels.filter(c=>c.active).reduce((s,c)=>s+c.ring.get(c.ring.size-1),0)) /
                              (channels.filter(c=>c.active).length || 1);
                }
                yRange = Math.max(1e-9, yRange * factor);
            } else {
                const maxSz = Math.max(...channels.filter(c=>c.active).map(c=>c.ring.size), 2);
                xView = Math.min(maxSz, Math.max(2, Math.round(xView * factor)));
            }
            dirty = true; scheduleDraw();
        }, { passive: false });

        /* Public API */
        function pushChannel(n, v, opts = {}) {
            if (n < 0 || n >= MAX_CH) return;
            const c = channels[n];
            c.ring.push(v);
            c.active = true;
            if (opts.color     !== undefined) c.color     = opts.color;
            if (opts.lineWidth !== undefined) c.lineWidth = opts.lineWidth;
            if (opts.label     !== undefined) c.label     = opts.label;
            dirty = true;
            scheduleDraw();
        }

        function setMaxPoints(n) {
            channels.forEach(c => c.ring.resize(n));
            xView = Math.min(xView, n);
        }

        function clearChannels() {
            channels.forEach(c => { c.ring.clear(); c.active = false; });
            dirty = true; scheduleDraw();
        }

        function exportCSV() {
            const active = channels.map((c, i) => ({ c, i })).filter(({ c }) => c.active && c.ring.size > 0);
            if (!active.length) return;
            const maxLen = Math.max(...active.map(({ c }) => c.ring.size));
            const header = ['Index', ...active.map(({ c, i }) => c.label || `Ch${i}`)].join(',');
            const rows   = [header];
            for (let r = 0; r < maxLen; r++) {
                const row = [r];
                for (const { c } of active) {
                    const offset = r - (maxLen - c.ring.size);
                    row.push(offset >= 0 ? c.ring.get(offset).toFixed(8) : '');
                }
                rows.push(row.join(','));
            }
            const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
            const url  = URL.createObjectURL(blob);
            const a    = Object.assign(document.createElement('a'), { href: url, download: `waveform_${Date.now()}.csv` });
            a.click(); URL.revokeObjectURL(url);
        }

        widgetAPI.set(el.id, { pushChannel, setMaxPoints, clearChannels, exportCSV,
                                getChannels: () => channels });
        scheduleDraw();
        break;
    }

    /* ── Display widgets: script-driven ── */
    case 'attitude': {
        body.innerHTML = `
            <div class="att-vals">
                <div><span class="att-label">Ch0</span><span class="att-num att-ch0">—</span></div>
                <div><span class="att-label">Ch1</span><span class="att-num att-ch1">—</span></div>
                <div><span class="att-label">Ch2</span><span class="att-num att-ch2">—</span></div>
            </div>
            <div class="att-bar-group">
                <div class="att-bar-wrap"><div class="att-bar att-bar0" style="width:50%"></div></div>
                <div class="att-bar-wrap"><div class="att-bar att-bar1" style="width:50%"></div></div>
                <div class="att-bar-wrap"><div class="att-bar att-bar2" style="width:50%"></div></div>
            </div>`;
        const vals = ['.att-ch0','.att-ch1','.att-ch2'].map(s => body.querySelector(s));
        const bars = ['.att-bar0','.att-bar1','.att-bar2'].map(s => body.querySelector(s));
        widgetAPI.set(el.id, {
            pushChannel(n, v) {
                if (n > 2) return;
                if (vals[n]) vals[n].textContent = v.toFixed(2);
                if (bars[n]) bars[n].style.width = Math.min(100, Math.max(0, (v / 360 + 0.5) * 100)).toFixed(1) + '%';
            }
        });
        body.insertAdjacentHTML('beforeend',
            '<div class="widget-hint-script">在属性面板绑定脚本<br>ch(0)=Roll ch(1)=Pitch ch(2)=Yaw</div>');
        break;
    }

    case 'gauge':
    case 'number': {
        body.innerHTML = `<div class="num-center"><div class="num-val">—</div><div class="num-unit" style="font-size:10px;color:var(--text-dim);margin-top:4px">绑定脚本后生效</div></div>`;
        const valEl = body.querySelector('.num-val');
        widgetAPI.set(el.id, { pushChannel(n, v) { if (n === 0) valEl.textContent = typeof v === 'number' ? v.toFixed(4) : v; } });
        break;
    }

    case 'progressbar': {
        body.innerHTML = `
            <div style="padding:0 8px;display:flex;flex-direction:column;justify-content:center;gap:6px;height:100%">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary)">
                    <span class="pb-label">进度</span><span class="pb-text">—</span>
                </div>
                <div class="pb-track"><div class="pb-fill" style="width:0%"></div></div>
            </div>`;
        const fill = body.querySelector('.pb-fill');
        const txt  = body.querySelector('.pb-text');
        widgetAPI.set(el.id, {
            pushChannel(n, v) {
                if (n !== 0) return;
                const pct = Math.min(100, Math.max(0, v));
                fill.style.width = pct.toFixed(1) + '%';
                txt.textContent  = pct.toFixed(1) + '%';
            }
        });
        break;
    }

    case 'statuslight': {
        body.innerHTML = `<div class="sl-center"><div class="sl-dot"></div><div class="sl-label">—</div></div>`;
        const dot   = body.querySelector('.sl-dot');
        const label = body.querySelector('.sl-label');
        widgetAPI.set(el.id, {
            pushChannel(n, v) {
                if (n !== 0) return;
                if (v > 0) { dot.className = 'sl-dot sl-on';  label.textContent = String(v); }
                else        { dot.className = 'sl-dot sl-off'; label.textContent = '—'; }
            }
        });
        break;
    }

    case 'text': {
        body.innerHTML = `<div class="text-body" style="padding:8px;word-break:break-all">— 绑定脚本后生效 —</div>`;
        const tb = body.querySelector('.text-body');
        widgetAPI.set(el.id, { pushChannel(n, v) { if (n === 0) tb.textContent = String(v); } });
        break;
    }

    /* ── Control widgets: send custom frames ── */
    case 'switch': {
        body.innerHTML = `
            <div class="sw-center">
                <div class="sw-hint" style="font-size:9px;color:var(--text-dim);margin-bottom:6px">在属性面板配置 ON / OFF 帧</div>
                <div style="display:flex;gap:8px">
                    <button class="sw-btn sw-on">ON</button>
                    <button class="sw-btn sw-off">OFF</button>
                </div>
            </div>`;
        function sendCtrl(frameKey) {
            const cfg  = widgetConfigs.get(el.id) || {};
            const fc   = cfg[frameKey];
            if (!fc || fc.func == null) {
                appendDecodedLog('info', new Date(), '—', 'System', '请先在属性面板配置帧', 'err');
                return;
            }
            const addr = parseInt(document.getElementById('target-addr').value, 16) || 1;
            const fr   = buildFrame(addr, fc.func, fc.stat ?? (frameKey==='onFrame'?0x11:0x10), fc.data || []);
            appendFrameLog('tx', new Date(), fr.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '), 'Widget TX');
            serialSend(fr);
        }
        body.querySelector('.sw-on') .addEventListener('click', () => sendCtrl('onFrame'));
        body.querySelector('.sw-off').addEventListener('click', () => sendCtrl('offFrame'));
        break;
    }

    case 'slider': {
        body.innerHTML = `
            <div style="padding:0 8px;display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary)">
                    <span class="sl-lbl">值</span><span class="sl-val-text">—</span>
                </div>
                <input type="range" min="0" max="255" value="128" class="sl-range">
                <div style="font-size:9px;color:var(--text-dim)">在属性面板配置 ON 帧，Data 用 <b>\${v}</b> 占位</div>
            </div>`;
        const range  = body.querySelector('.sl-range');
        const valTxt = body.querySelector('.sl-val-text');
        range.addEventListener('input', () => { valTxt.textContent = range.value; });
        range.addEventListener('change', () => {
            const cfg  = widgetConfigs.get(el.id) || {};
            const fc   = cfg.onFrame;
            if (!fc || fc.func == null) return;
            const addr = parseInt(document.getElementById('target-addr').value, 16) || 1;
            /* Replace placeholder ${v} in data with slider value */
            const rawData = (fc.data || []).map(b => b === 0xFE ? parseInt(range.value) : b);
            const fr = buildFrame(addr, fc.func, fc.stat ?? 0x11, rawData);
            appendFrameLog('tx', new Date(), fr.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '), 'Slider TX');
            serialSend(fr);
        });
        break;
    }

    case 'xy':
    case 'script':
    default: {
        body.innerHTML = `<div style="color:var(--text-dim);font-size:11px;padding:8px;text-align:center">在属性面板绑定脚本</div>`;
        const vals = [];
        widgetAPI.set(el.id, { pushChannel(n, v) { vals[n] = v; } });
        break;
    }
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
