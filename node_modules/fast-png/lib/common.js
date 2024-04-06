"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crc = exports.pngSignature = void 0;
exports.pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = [];
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        if (c & 1) {
            c = 0xedb88320 ^ (c >>> 1);
        }
        else {
            c = c >>> 1;
        }
    }
    crcTable[n] = c;
}
const initialCrc = 0xffffffff;
function updateCrc(currentCrc, data, length) {
    let c = currentCrc;
    for (let n = 0; n < length; n++) {
        c = crcTable[(c ^ data[n]) & 0xff] ^ (c >>> 8);
    }
    return c;
}
function crc(data, length) {
    return (updateCrc(initialCrc, data, length) ^ initialCrc) >>> 0;
}
exports.crc = crc;
//# sourceMappingURL=common.js.map