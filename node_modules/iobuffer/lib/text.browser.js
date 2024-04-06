"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encode = exports.decode = void 0;
// eslint-disable-next-line import/no-unassigned-import
require("./text-encoding-polyfill");
function decode(bytes, encoding = 'utf8') {
    const decoder = new TextDecoder(encoding);
    return decoder.decode(bytes);
}
exports.decode = decode;
const encoder = new TextEncoder();
function encode(str) {
    return encoder.encode(str);
}
exports.encode = encode;
//# sourceMappingURL=text.browser.js.map