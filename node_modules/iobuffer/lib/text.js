"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encode = exports.decode = void 0;
const util_1 = require("util");
function decode(bytes, encoding = 'utf8') {
    const decoder = new util_1.TextDecoder(encoding);
    return decoder.decode(bytes);
}
exports.decode = decode;
const encoder = new util_1.TextEncoder();
function encode(str) {
    return encoder.encode(str);
}
exports.encode = encode;
//# sourceMappingURL=text.js.map