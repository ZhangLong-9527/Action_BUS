'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let mainWindow = null;
let activePort = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        frame: false,
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, 'UI/logo.png'),
    });
    mainWindow.loadFile('src/index.html');
    mainWindow.on('closed', () => { mainWindow = null; });
}

/* ── Window controls ─────────────────────────────────── */
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

/* ── Serial: list ports ──────────────────────────────── */
ipcMain.handle('serial:list', async () => {
    try {
        const list = await SerialPort.list();
        return {
            ok: true,
            ports: list.map(p => ({
                path:         p.path,
                manufacturer: p.manufacturer || '',
                serialNumber: p.serialNumber || '',
            })),
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

/* ── Serial: connect ─────────────────────────────────── */
ipcMain.handle('serial:connect', async (_, portPath, baudRate) => {
    try {
        // close existing
        if (activePort && activePort.isOpen) {
            await new Promise(res => activePort.close(() => res()));
        }

        const sp = new SerialPort({ path: portPath, baudRate: parseInt(baudRate, 10), autoOpen: false });

        sp.on('data', data => {
            mainWindow?.webContents.send('serial:data', Array.from(data));
        });
        sp.on('error', err => {
            mainWindow?.webContents.send('serial:error', err.message);
        });
        sp.on('close', () => {
            activePort = null;
            mainWindow?.webContents.send('serial:closed');
        });

        await new Promise((resolve, reject) => sp.open(err => err ? reject(err) : resolve()));

        activePort = sp;
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

/* ── Serial: disconnect ──────────────────────────────── */
ipcMain.handle('serial:disconnect', async () => {
    if (activePort && activePort.isOpen) {
        await new Promise(res => activePort.close(() => res()));
    }
    activePort = null;
    return { ok: true };
});

/* ── Serial: send bytes ──────────────────────────────── */
ipcMain.handle('serial:send', async (_, bytes) => {
    if (!activePort || !activePort.isOpen) {
        return { ok: false, error: 'not connected' };
    }
    try {
        await new Promise((resolve, reject) =>
            activePort.write(Buffer.from(bytes), err => err ? reject(err) : resolve())
        );
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

/* ── App lifecycle ───────────────────────────────────── */
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (activePort && activePort.isOpen) activePort.close(() => {});
});
