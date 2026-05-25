// Try different ways to access electron APIs
console.log('1. require("electron"):', typeof require('electron'));
const e1 = require('electron');
console.log('   Keys:', Object.keys(e1 || {}).slice(0, 10));

console.log('2. process.binding("electron_common"):', typeof process.binding('electron_common'));

console.log('3. global.electron:', typeof global.electron);

console.log('4. internalBinding("electron"):', typeof internalBinding('electron'));
