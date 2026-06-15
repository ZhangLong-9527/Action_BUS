'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /* Window controls */
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),

    /* Serial port */
    serial: {
        list:       ()           => ipcRenderer.invoke('serial:list'),
        connect:    (path, baud) => ipcRenderer.invoke('serial:connect', path, baud),
        disconnect: ()           => ipcRenderer.invoke('serial:disconnect'),
        send:       (bytes)      => ipcRenderer.invoke('serial:send', bytes),

        onData:   cb => ipcRenderer.on('serial:data',   (_, b) => cb(b)),
        onError:  cb => ipcRenderer.on('serial:error',  (_, m) => cb(m)),
        onClosed: cb => ipcRenderer.on('serial:closed', ()     => cb()),
    },
});
