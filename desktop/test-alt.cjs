// Try alternative ways to access Electron APIs
const Module = require('module');
const origResolve = Module._resolveFilename;

// Check if __non_webpack_require__ exists
console.log('typeof __non_webpack_require__:', typeof __non_webpack_require__);

// Try require with explicit paths
try {
  const e = require('electron/main');
  console.log('electron/main:', typeof e, Object.keys(e).slice(0,5));
} catch(ex) { console.log('electron/main failed:', ex.message); }

try {
  const e = require('electron/common');
  console.log('electron/common:', typeof e, Object.keys(e).slice(0,5));
} catch(ex) { console.log('electron/common failed:', ex.message); }
