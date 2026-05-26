const e = require('electron');
console.log('typeof require(electron):', typeof e);
console.log('Is function (getElectronPath):', typeof e === 'function');
console.log('Is string:', typeof e === 'string');
if (typeof e === 'object') {
  console.log('keys:', Object.keys(e).slice(0, 10));
}
