const mod = module.constructor._resolveFilename;
const orig = mod;
const result = require.resolve('electron');
console.log('resolved to:', result);
