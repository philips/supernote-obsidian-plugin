"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guessStripByteCounts = void 0;
function guessStripByteCounts(ifd) {
    if (ifd.compression !== 1) {
        throw new Error('missing mandatory StripByteCounts field in compressed image');
    }
    const bytesPerStrip = ifd.rowsPerStrip *
        ifd.width *
        ifd.samplesPerPixel *
        (ifd.bitsPerSample / 8);
    return new Array(ifd.stripOffsets.length).fill(bytesPerStrip);
}
exports.guessStripByteCounts = guessStripByteCounts;
//# sourceMappingURL=hacks.js.map