// Loaded with `node --require` by `npm run dev` and `npm test`. The sources import their
// siblings as './x.js' (as tsc's output needs), but ts-node's CommonJS hook
// does not map that back to x.ts, so retry a missing relative .js import
// without the extension and let ts-node resolve the .ts file.
const Module = require('module');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  try {
    return resolve.call(this, request, ...rest);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /^\.{1,2}\/.+\.js$/.test(request)) {
      return resolve.call(this, request.slice(0, -3), ...rest);
    }
    throw err;
  }
};

require('ts-node/register');
