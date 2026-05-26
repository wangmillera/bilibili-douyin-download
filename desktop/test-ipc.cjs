console.log('electron typeof:', typeof require('electron'));
const e = require('electron');
console.log('keys:', Object.keys(e).slice(0, 10));
console.log('ipcMain:', typeof e.ipcMain);
console.log('app:', typeof e.app);
