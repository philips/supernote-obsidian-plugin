'use strict';

const IOBuffer = require('iobuffer');
const tiff = require('tiff');

function decode(data) {
    const buffer = new IOBuffer(data);
    const result = {};
    buffer.setBigEndian();
    const val = buffer.readUint16();
    if (val !== 0xffd8) {
        throw new Error('SOI marker not found. Not a valid JPEG file');
    }
    const next = buffer.readUint16();
    if (next === 0xffe1) {
        const length = buffer.readUint16();
        const header = buffer.readBytes(6);
        if (header[0] === 69 && // E
            header[1] === 120 && // x
            header[2] === 105 && // i
            header[3] === 102 && // f
            header[4] === 0 &&
            header[5] === 0) {
       //     buffer.skip(2);
            const exif = tiff.decode(buffer, {
                onlyFirst: true,
                ignoreImageData: true,
                offset: buffer.offset
            });
            result.exif = exif;
        }
    }
    return result;
}

module.exports = decode;
