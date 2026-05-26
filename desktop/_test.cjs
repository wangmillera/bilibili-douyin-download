console.log("Node module paths:", module.paths.slice(0,3));
const e = require('electron');
console.log("Electron type:", typeof e);
console.log("Electron:", e);
process.exit(0);
