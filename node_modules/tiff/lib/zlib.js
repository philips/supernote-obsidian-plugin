"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decompressZlib = void 0;
const pako_1 = require("pako");
function decompressZlib(stripData) {
    const stripUint8 = new Uint8Array(stripData.buffer, stripData.byteOffset, stripData.byteLength);
    const inflated = (0, pako_1.inflate)(stripUint8);
    return new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}
exports.decompressZlib = decompressZlib;
//# sourceMappingURL=zlib.js.map