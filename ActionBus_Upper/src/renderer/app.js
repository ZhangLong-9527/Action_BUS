/* ============================================
   ActionBus Master - Renderer
   ============================================ */

/* ---------- Window controls ---------- */
document.getElementById('btn-min').addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('btn-max').addEventListener('click', () => window.electronAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.electronAPI.close());

/* ---------- Left panel: collapse + drag resize ---------- */
const leftPanel       = document.getElementById('left-panel');
const leftSep         = document.getElementById('left-sep');
const btnCollapseLeft = document.getElementById('btn-collapse-left');
const btnExpandLeft   = document.getElementById('btn-expand-left');

let savedLeftWidth = parseInt(getComputedStyle(leftPanel).width) || 280;

btnCollapseLeft.addEventListener('click', () => {
    savedLeftWidth = leftPanel.offsetWidth;
    leftPanel.classList.add('collapsed');
    leftSep.style.display = 'none';
    btnExpandLeft.style.display = 'flex';
});

btnExpandLeft.addEventListener('click', () => {
    leftPanel.classList.remove('collapsed');
    leftPanel.style.width = savedLeftWidth + 'px';
    leftSep.style.display = '';
    btnExpandLeft.style.display = 'none';
});

leftSep.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = leftPanel.offsetWidth;

    function onMove(mv) {
        const w = Math.max(160, Math.min(520, startWidth + (mv.clientX - startX)));
        leftPanel.style.width = w + 'px';
    }
    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

/* ---------- Bottom panel: drag resize ---------- */
const bottomPanel  = document.getElementById('bottom-panel');
const bottomHandle = document.getElementById('bottom-resize-handle');

bottomHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY      = e.clientY;
    const startHeight = bottomPanel.offsetHeight;

    function onMove(mv) {
        const h = Math.max(80, Math.min(600, startHeight - (mv.clientY - startY)));
        bottomPanel.style.height = h + 'px';
    }
    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

/* ---------- Manual send bar ---------- */
const toggleAssemble    = document.getElementById('toggle-assemble');
const sendSwLabel       = document.getElementById('send-sw-label');
const sendAssembleFields = document.getElementById('send-assemble-fields');
const sendRawFields     = document.getElementById('send-raw-fields');
const sendFuncInput     = document.getElementById('send-func');
const sendDataInput     = document.getElementById('send-data');
const sendRawInput      = document.getElementById('send-raw');
const btnManualSend     = document.getElementById('btn-manual-send');

let assembleMode = true;
toggleAssemble.classList.add('on');

toggleAssemble.addEventListener('click', () => {
    assembleMode = !assembleMode;
    toggleAssemble.classList.toggle('on', assembleMode);
    sendSwLabel.textContent         = assembleMode ? '组帧' : '原始';
    sendAssembleFields.style.display = assembleMode ? '' : 'none';
    sendRawFields.style.display     = assembleMode ? 'none' : '';
});

function crc16modbus(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) {
        crc ^= b;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
        }
    }
    return crc;
}

function parseHex(str) {
    return str.trim().replace(/0x/gi, '').split(/[\s,]+/)
        .filter(Boolean).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
}

function flashError(el) {
    el.classList.add('error');
    setTimeout(() => el.classList.remove('error'), 800);
}

function doSend() {
    let frameBytes;
    if (assembleMode) {
        const addrStr = document.getElementById('target-addr').value.trim();
        const addr    = parseInt(addrStr, 16);
        const func    = parseInt(sendFuncInput.value.trim().replace(/^0x/i, ''), 16);
        const data    = parseHex(sendDataInput.value);

        if (isNaN(addr) || isNaN(func)) { flashError(sendFuncInput); return; }

        const body = [addr, func, 0x11, data.length, ...data];
        const crc  = crc16modbus(body);
        frameBytes = [0xAA, 0x55, ...body, (crc >> 8) & 0xFF, crc & 0xFF];
    } else {
        frameBytes = parseHex(sendRawInput.value);
        if (!frameBytes.length) { flashError(sendRawInput); return; }
    }

    const hexStr = frameBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    appendFrameLog('tx', new Date(), hexStr, assembleMode ? '手动组帧' : '手动原始');
}

btnManualSend.addEventListener('click', doSend);
[sendFuncInput, sendDataInput, sendRawInput].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
});

/* ---------- Left panel tabs ---------- */
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + target).classList.add('active');
    });
});

/* ---------- Device node expand/collapse ---------- */
document.querySelectorAll('.device-node-header').forEach(header => {
    header.addEventListener('click', () => {
        header.closest('.device-node').classList.toggle('expanded');
    });
});

/* ---------- Baud custom input ---------- */
const baudSelect = document.getElementById('baud-select');
baudSelect.addEventListener('change', () => {
    if (baudSelect.value === 'custom') {
        const val = prompt('请输入波特率（1200–4000000）：');
        if (val && /^\d+$/.test(val) && +val >= 1200 && +val <= 4000000) {
            const opt = new Option(val, val, true, true);
            baudSelect.insertBefore(opt, baudSelect.lastElementChild);
            baudSelect.value = val;
        } else {
            baudSelect.value = '115200';
        }
    }
});

/* ---------- Connect button ---------- */
const btnConnect = document.getElementById('btn-connect');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
let connected = false;

btnConnect.addEventListener('click', () => {
    connected = !connected;
    if (connected) {
        statusDot.className  = 'status-dot connected';
        statusText.className = 'status-text connected';
        statusText.textContent = 'CONNECTED';
        btnConnect.textContent = 'Disconnect';
        btnConnect.classList.replace('primary', 'danger');
        appendFrameLog('tx', new Date(), 'AA 55 01 F0 11 01 02 xx xx', '查询 Action 数量');
        appendDecodedLog('rx', new Date(), '0xF0', 'GET_ACTION_COUNT', '返回 count=3', 'ok');
    } else {
        statusDot.className  = 'status-dot';
        statusText.className = 'status-text';
        statusText.textContent = 'DISCONNECTED';
        btnConnect.textContent = 'Connect';
        btnConnect.classList.replace('danger', 'primary');
    }
});

/* ---------- Grid snap toggle ---------- */
let gridSnap = true;
document.getElementById('btn-grid-snap').addEventListener('click', function () {
    gridSnap = !gridSnap;
    this.textContent = gridSnap ? '网格吸附 ✓' : '网格吸附';
});

/* ---------- Drag-and-drop: widget palette → canvas ---------- */
const canvas = document.getElementById('action-canvas');
const canvasHint = document.getElementById('canvas-hint');

const WIDGET_META = {
    waveform:    { icon: '📈', name: '波形图',         w: 380, h: 220 },
    attitude:    { icon: '🎲', name: '3D 姿态（立方体）', w: 260, h: 240 },
    gauge:       { icon: '🕹️', name: '仪表盘',         w: 200, h: 200 },
    number:      { icon: '#',  name: '数字显示',        w: 160, h: 120 },
    progressbar: { icon: '▬',  name: '进度条',          w: 260, h: 100 },
    xy:          { icon: '⊹',  name: 'XY 散点图',      w: 300, h: 260 },
    switch:      { icon: '🔘', name: '开关按键',        w: 180, h: 120 },
    slider:      { icon: '⇔',  name: '滑块',            w: 280, h: 100 },
    text:        { icon: 'T',  name: '文本标签',        w: 180, h: 90  },
    statuslight: { icon: '🔴', name: '状态灯',          w: 140, h: 100 },
    script:      { icon: '{}', name: 'JS 脚本解码器',  w: 360, h: 240 },
};

let dragWidgetType = null;

document.querySelectorAll('.widget-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', e => {
        dragWidgetType = card.dataset.type;
        e.dataTransfer.effectAllowed = 'copy';
    });
    card.addEventListener('dragend', () => { dragWidgetType = null; });
});

canvas.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });

canvas.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragWidgetType) return;
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    if (gridSnap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
    createWidgetInstance(dragWidgetType, x, y);
    dragWidgetType = null;
});

/* ---------- Create widget instance on canvas ---------- */
function createWidgetInstance(type, x, y) {
    const meta = WIDGET_META[type];
    if (!meta) return;

    canvasHint.style.display = 'none';

    const el = document.createElement('div');
    el.className = 'canvas-widget';
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.width  = meta.w + 'px';
    el.style.height = meta.h + 'px';

    el.innerHTML = `
        <div class="widget-titlebar">
            <span class="widget-titlebar-icon">${meta.icon}</span>
            <span class="widget-titlebar-name">${meta.name}</span>
            <button class="widget-close-btn" title="关闭">✕</button>
        </div>
        <div class="widget-body">${buildWidgetBody(type)}</div>
        <div class="widget-resize"></div>
    `;

    canvas.appendChild(el);
    makeDraggable(el);
    makeResizable(el);

    el.querySelector('.widget-close-btn').addEventListener('click', () => {
        el.remove();
        if (!canvas.querySelector('.canvas-widget')) {
            canvasHint.style.display = '';
        }
    });

    el.addEventListener('mousedown', () => {
        document.querySelectorAll('.canvas-widget').forEach(w => w.classList.remove('selected'));
        el.classList.add('selected');
    });
}

function buildWidgetBody(type) {
    switch (type) {
    case 'waveform':
        return `
            <div style="height:100%;display:flex;flex-direction:column;gap:6px;">
                <div style="display:flex;gap:6px;align-items:center;">
                    <span style="font-size:10px;color:var(--text-secondary);">CH1</span>
                    <span style="width:20px;height:2px;background:#3b82f6;border-radius:2px;"></span>
                    <span style="font-size:10px;color:var(--text-secondary);">CH2</span>
                    <span style="width:20px;height:2px;background:#f59e0b;border-radius:2px;"></span>
                    <div style="flex:1;"></div>
                    <span style="font-size:10px;color:var(--text-dim);">Action: —</span>
                </div>
                <canvas id="wf-${Date.now()}" style="flex:1;width:100%;background:var(--bg-canvas);border-radius:4px;"></canvas>
            </div>`;
    case 'attitude':
        return `
            <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;">
                <div style="width:100px;height:100px;background:var(--bg-canvas);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:40px;border:1px solid var(--border);">🎲</div>
                <div style="font-size:10px;color:var(--text-secondary);text-align:center;">Roll: 0°&nbsp;&nbsp;Pitch: 0°&nbsp;&nbsp;Yaw: 0°</div>
            </div>`;
    case 'gauge':
        return `
            <div style="height:100%;display:flex;align-items:center;justify-content:center;">
                <div style="text-align:center;">
                    <div style="font-size:28px;font-weight:700;color:var(--accent);font-family:var(--font-mono);">0.00</div>
                    <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">单位 / 量程</div>
                </div>
            </div>`;
    case 'number':
        return `
            <div style="height:100%;display:flex;align-items:center;justify-content:center;">
                <div style="font-size:36px;font-weight:700;color:var(--accent);font-family:var(--font-mono);">—</div>
            </div>`;
    case 'progressbar':
        return `
            <div style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:0 4px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);">
                    <span>Progress</span><span>0 / 100</span>
                </div>
                <div style="height:10px;background:var(--bg-canvas);border-radius:5px;overflow:hidden;border:1px solid var(--border);">
                    <div style="width:0%;height:100%;background:var(--accent);border-radius:5px;transition:width .3s;"></div>
                </div>
            </div>`;
    case 'xy':
        return `
            <div style="height:100%;display:flex;align-items:center;justify-content:center;">
                <canvas style="width:100%;height:100%;background:var(--bg-canvas);border-radius:4px;border:1px solid var(--border);"></canvas>
            </div>`;
    case 'switch':
        return `
            <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">
                <div style="font-size:10px;color:var(--text-secondary);">Action: —</div>
                <div style="display:flex;gap:8px;">
                    <button style="padding:6px 18px;background:var(--green);border:none;border-radius:var(--radius-sm);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">ON</button>
                    <button style="padding:6px 18px;background:var(--bg-widget);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-secondary);font-size:12px;cursor:pointer;">OFF</button>
                </div>
            </div>`;
    case 'slider':
        return `
            <div style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:0 4px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);">
                    <span>Value</span><span id="slider-val-${Date.now()}">0</span>
                </div>
                <input type="range" min="0" max="100" value="0" style="width:100%;accent-color:var(--accent);">
            </div>`;
    case 'text':
        return `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text-secondary);">— 无数据 —</div>`;
    case 'statuslight':
        return `
            <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;">
                <div style="width:32px;height:32px;border-radius:50%;background:var(--text-dim);box-shadow:0 0 12px var(--text-dim);transition:background .3s,box-shadow .3s;"></div>
                <span style="font-size:10px;color:var(--text-secondary);">UNKNOWN</span>
            </div>`;
    case 'script':
        return `
            <div style="height:100%;display:flex;flex-direction:column;gap:6px;">
                <div style="font-size:10px;color:var(--text-secondary);">绑定 Action: —</div>
                <textarea spellcheck="false" style="flex:1;width:100%;background:var(--bg-canvas);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-family:var(--font-mono);font-size:11px;padding:6px;resize:none;outline:none;">// frame.data 为 Uint8Array
var val = util.readFloat32BE(frame.data, 0);
channel.push("ch1", val);</textarea>
            </div>`;
    default:
        return `<div style="color:var(--text-dim);font-size:11px;padding:8px;">未知控件类型</div>`;
    }
}

/* ---------- Make widget draggable on canvas ---------- */
function makeDraggable(el) {
    const handle = el.querySelector('.widget-titlebar');
    let ox = 0, oy = 0, startX = 0, startY = 0;

    handle.addEventListener('mousedown', e => {
        if (e.target.classList.contains('widget-close-btn')) return;
        e.preventDefault();
        startX = e.clientX; startY = e.clientY;
        ox = el.offsetLeft;  oy = el.offsetTop;

        function onMove(e) {
            let x = ox + (e.clientX - startX);
            let y = oy + (e.clientY - startY);
            if (gridSnap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
            x = Math.max(0, x); y = Math.max(0, y);
            el.style.left = x + 'px';
            el.style.top  = y + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

/* ---------- Make widget resizable ---------- */
function makeResizable(el) {
    const handle = el.querySelector('.widget-resize');
    let startX = 0, startY = 0, startW = 0, startH = 0;

    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX; startY = e.clientY;
        startW = el.offsetWidth; startH = el.offsetHeight;

        function onMove(e) {
            const w = Math.max(140, startW + (e.clientX - startX));
            const h = Math.max(90,  startH + (e.clientY - startY));
            el.style.width  = w + 'px';
            el.style.height = h + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

/* ---------- Clear canvas ---------- */
document.getElementById('btn-clear-canvas').addEventListener('click', () => {
    canvas.querySelectorAll('.canvas-widget').forEach(w => w.remove());
    canvasHint.style.display = '';
});

/* ---------- Log helpers ---------- */
const frameLogBody   = document.getElementById('frame-log-body');
const decodedLogBody = document.getElementById('decoded-log-body');

function fmtTime(d) {
    return d.toTimeString().slice(0, 8) + '.' +
           String(d.getMilliseconds()).padStart(3, '0');
}

function appendFrameLog(dir, time, hex, note) {
    const row = document.createElement('div');
    row.className = 'log-row';
    const coloredHex = hex.replace(/([0-9A-Fa-f]{2})/g, (m, b, i) => {
        const cls = i === 0 ? 'byte-head' : 'byte-data';
        return `<span class="${cls}">${b} </span>`;
    });
    row.innerHTML = `
        <span class="log-ts">${fmtTime(time)}</span>
        <span class="log-dir ${dir}">${dir.toUpperCase()}</span>
        <span class="log-hex">${coloredHex}</span>
    `;
    frameLogBody.appendChild(row);
    frameLogBody.scrollTop = frameLogBody.scrollHeight;
}

function appendDecodedLog(dir, time, func, action, detail, status) {
    const row = document.createElement('div');
    row.className = 'decoded-row';
    const cls = status === 'ok' ? 'dc-ok' : status === 'err' ? 'dc-err' : 'dc-val';
    row.innerHTML = `
        <span class="decoded-ts">${fmtTime(time)}</span>
        <span class="decoded-content">
            <span class="dc-func">${func}</span>
            <span style="color:var(--text-dim);"> · </span>
            <span>${action}</span>
            <span style="color:var(--text-dim);"> → </span>
            <span class="${cls}">${detail}</span>
        </span>
    `;
    decodedLogBody.appendChild(row);
    decodedLogBody.scrollTop = decodedLogBody.scrollHeight;
}

/* ---------- Settings panel ---------- */
const THEMES = {
    'dark-blue': {
        '--bg-base':      '#0d1117',
        '--bg-panel':     '#161b22',
        '--bg-widget':    '#1c2230',
        '--bg-input':     '#0d1117',
        '--bg-canvas':    '#111827',
        '--bg-hover':     '#21262d',
        '--border':       '#30363d',
        '--border-focus': '#3b82f6',
        '--accent':       '#3b82f6',
        '--accent-hover': '#2563eb',
        '--accent-dim':   'rgba(59,130,246,0.15)',
    },
    'dark-purple': {
        '--bg-base':      '#0e0b1a',
        '--bg-panel':     '#14112a',
        '--bg-widget':    '#1a1738',
        '--bg-input':     '#0e0b1a',
        '--bg-canvas':    '#100e1f',
        '--bg-hover':     '#1e1a40',
        '--border':       '#2d2850',
        '--border-focus': '#8b5cf6',
        '--accent':       '#8b5cf6',
        '--accent-hover': '#7c3aed',
        '--accent-dim':   'rgba(139,92,246,0.15)',
    },
    'dark-cyan': {
        '--bg-base':      '#091214',
        '--bg-panel':     '#0e1e22',
        '--bg-widget':    '#132830',
        '--bg-input':     '#091214',
        '--bg-canvas':    '#0b1618',
        '--bg-hover':     '#173038',
        '--border':       '#1e3840',
        '--border-focus': '#06b6d4',
        '--accent':       '#06b6d4',
        '--accent-hover': '#0891b2',
        '--accent-dim':   'rgba(6,182,212,0.15)',
    },
    'dark-green': {
        '--bg-base':      '#091210',
        '--bg-panel':     '#0e1e1a',
        '--bg-widget':    '#132820',
        '--bg-input':     '#091210',
        '--bg-canvas':    '#0b1512',
        '--bg-hover':     '#173025',
        '--border':       '#1e3828',
        '--border-focus': '#10b981',
        '--accent':       '#10b981',
        '--accent-hover': '#059669',
        '--accent-dim':   'rgba(16,185,129,0.15)',
    },
    'dark-orange': {
        '--bg-base':      '#130e08',
        '--bg-panel':     '#1e1610',
        '--bg-widget':    '#281d14',
        '--bg-input':     '#130e08',
        '--bg-canvas':    '#150f08',
        '--bg-hover':     '#302010',
        '--border':       '#3d2d18',
        '--border-focus': '#f97316',
        '--accent':       '#f97316',
        '--accent-hover': '#ea6a00',
        '--accent-dim':   'rgba(249,115,22,0.15)',
    },
    'chinese-red': {
        '--bg-base':      '#120808',
        '--bg-panel':     '#1e0e0e',
        '--bg-widget':    '#280f0f',
        '--bg-input':     '#120808',
        '--bg-canvas':    '#140909',
        '--bg-hover':     '#301010',
        '--border':       '#3d1515',
        '--border-focus': '#c0272d',
        '--accent':       '#c0272d',
        '--accent-hover': '#a01f24',
        '--accent-dim':   'rgba(192,39,45,0.15)',
    },
    'dark-amber': {
        '--bg-base':      '#130f06',
        '--bg-panel':     '#1e180a',
        '--bg-widget':    '#28200e',
        '--bg-input':     '#130f06',
        '--bg-canvas':    '#15110a',
        '--bg-hover':     '#302810',
        '--border':       '#3d3015',
        '--border-focus': '#f59e0b',
        '--accent':       '#f59e0b',
        '--accent-hover': '#d97706',
        '--accent-dim':   'rgba(245,158,11,0.15)',
    },
    'pitch-black': {
        '--bg-base':      '#060608',
        '--bg-panel':     '#0c0c12',
        '--bg-widget':    '#111118',
        '--bg-input':     '#060608',
        '--bg-canvas':    '#080809',
        '--bg-hover':     '#16161f',
        '--border':       '#1e1e2a',
        '--border-focus': '#4d7cfe',
        '--accent':       '#4d7cfe',
        '--accent-hover': '#3a5fd4',
        '--accent-dim':   'rgba(77,124,254,0.15)',
    },
};

function applyTheme(key) {
    const t = THEMES[key];
    if (!t) return;
    const root = document.documentElement;
    Object.entries(t).forEach(([k, v]) => root.style.setProperty(k, v));
}

function setActiveThemeItem(key) {
    document.querySelectorAll('.theme-item').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === key);
    });
}

function loadTheme() {
    const saved = localStorage.getItem('ab-theme') || 'dark-blue';
    applyTheme(saved);
    setActiveThemeItem(saved);
}

document.querySelectorAll('.theme-item').forEach(item => {
    item.addEventListener('click', () => {
        const key = item.dataset.theme;
        applyTheme(key);
        setActiveThemeItem(key);
        localStorage.setItem('ab-theme', key);
    });
});

const settingsPanel = document.getElementById('settings-panel');
const btnSettings   = document.getElementById('btn-settings');

btnSettings.addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.classList.toggle('hidden');
});

document.addEventListener('click', e => {
    if (!settingsPanel.contains(e.target) && e.target !== btnSettings) {
        settingsPanel.classList.add('hidden');
    }
});

loadTheme();

/* ---------- Clear log buttons ---------- */
document.getElementById('btn-clear-frame').addEventListener('click',   () => { frameLogBody.innerHTML = ''; });
document.getElementById('btn-clear-decoded').addEventListener('click', () => { decodedLogBody.innerHTML = ''; });

/* ---------- Demo log entries on load ---------- */
const demoFrames = [
    ['tx', 'AA 55 01 F0 11 01 00 xx xx', '查询协议版本'],
    ['rx', 'AA 55 01 F0 00 02 03 00 xx xx', 'v3.0 返回'],
    ['tx', 'AA 55 01 F0 11 01 02 xx xx', '查询 Action 数量'],
    ['rx', 'AA 55 01 F0 00 01 03 xx xx', 'count=3'],
    ['tx', 'AA 55 01 FE 11 02 01 00 xx xx', 'GET_ENTRY index=0'],
    ['rx', 'AA 55 01 FE 00 0E 0B 0B 54 65 6D 70 65 72 61 74 75 72 65 xx xx', 'Temperature Read'],
    ['tx', 'AA 55 01 0B 11 02 00 64 xx xx', 'Temperature 订阅 100ms'],
    ['rx', 'AA 55 01 0B 01 04 01 2C 00 00 xx xx', '温度上报 30.0°C'],
];
const demoDecoded = [
    ['tx', '0xF0', 'GET_PROTOCOL_VERSION', '发送查询', 'val'],
    ['rx', '0xF0', 'GET_PROTOCOL_VERSION', 'v3.0', 'ok'],
    ['rx', '0xF0', 'GET_ACTION_COUNT', 'count = 3', 'ok'],
    ['rx', '0xFE', 'GET_ENTRY[0]', '0x0B → Temperature Read', 'ok'],
    ['tx', '0x0B', 'Subscribe', 'interval=100ms', 'val'],
    ['rx', '0x0B', 'Temperature Read', '30.0 °C', 'ok'],
];

demoFrames.forEach(([dir, hex, note], i) => {
    setTimeout(() => appendFrameLog(dir, new Date(Date.now() - (demoFrames.length - i) * 200), hex, note), i * 80);
});
demoDecoded.forEach(([dir, func, action, detail, status], i) => {
    setTimeout(() => appendDecodedLog(dir, new Date(Date.now() - (demoDecoded.length - i) * 200), func, action, detail, status), i * 80 + 40);
});
