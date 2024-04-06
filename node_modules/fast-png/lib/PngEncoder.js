"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const iobuffer_1 = require("iobuffer");
const pako_1 = require("pako");
const common_1 = require("./common");
const internalTypes_1 = require("./internalTypes");
const defaultZlibOptions = {
    level: 3,
};
class PngEncoder extends iobuffer_1.IOBuffer {
    constructor(data, options = {}) {
        super();
        this._colorType = internalTypes_1.ColorType.UNKNOWN;
        this._zlibOptions = { ...defaultZlibOptions, ...options.zlib };
        this._png = this._checkData(data);
        this.setBigEndian();
    }
    encode() {
        this.encodeSignature();
        this.encodeIHDR();
        this.encodeData();
        this.encodeIEND();
        return this.toArray();
    }
    // https://www.w3.org/TR/PNG/#5PNG-file-signature
    encodeSignature() {
        this.writeBytes(common_1.pngSignature);
    }
    // https://www.w3.org/TR/PNG/#11IHDR
    encodeIHDR() {
        this.writeUint32(13);
        this.writeChars('IHDR');
        this.writeUint32(this._png.width);
        this.writeUint32(this._png.height);
        this.writeByte(this._png.depth);
        this.writeByte(this._colorType);
        this.writeByte(internalTypes_1.CompressionMethod.DEFLATE);
        this.writeByte(internalTypes_1.FilterMethod.ADAPTIVE);
        this.writeByte(internalTypes_1.InterlaceMethod.NO_INTERLACE);
        this.writeCrc(17);
    }
    // https://www.w3.org/TR/PNG/#11IEND
    encodeIEND() {
        this.writeUint32(0);
        this.writeChars('IEND');
        this.writeCrc(4);
    }
    // https://www.w3.org/TR/PNG/#11IDAT
    encodeIDAT(data) {
        this.writeUint32(data.length);
        this.writeChars('IDAT');
        this.writeBytes(data);
        this.writeCrc(data.length + 4);
    }
    encodeData() {
        const { width, height, channels, depth, data } = this._png;
        const slotsPerLine = channels * width;
        const newData = new iobuffer_1.IOBuffer().setBigEndian();
        let offset = 0;
        for (let i = 0; i < height; i++) {
            newData.writeByte(0); // no filter
            /* istanbul ignore else */
            if (depth === 8) {
                offset = writeDataBytes(data, newData, slotsPerLine, offset);
            }
            else if (depth === 16) {
                offset = writeDataUint16(data, newData, slotsPerLine, offset);
            }
            else {
                throw new Error('unreachable');
            }
        }
        const buffer = newData.toArray();
        const compressed = (0, pako_1.deflate)(buffer, this._zlibOptions);
        this.encodeIDAT(compressed);
    }
    _checkData(data) {
        const { colorType, channels, depth } = getColorType(data);
        const png = {
            width: checkInteger(data.width, 'width'),
            height: checkInteger(data.height, 'height'),
            channels,
            data: data.data,
            depth,
            text: {},
        };
        this._colorType = colorType;
        const expectedSize = png.width * png.height * channels;
        if (png.data.length !== expectedSize) {
            throw new RangeError(`wrong data size. Found ${png.data.length}, expected ${expectedSize}`);
        }
        return png;
    }
    writeCrc(length) {
        this.writeUint32((0, common_1.crc)(new Uint8Array(this.buffer, this.byteOffset + this.offset - length, length), length));
    }
}
exports.default = PngEncoder;
function checkInteger(value, name) {
    if (Number.isInteger(value) && value > 0) {
        return value;
    }
    throw new TypeError(`${name} must be a positive integer`);
}
function getColorType(data) {
    const { channels = 4, depth = 8 } = data;
    if (channels !== 4 && channels !== 3 && channels !== 2 && channels !== 1) {
        throw new RangeError(`unsupported number of channels: ${channels}`);
    }
    if (depth !== 8 && depth !== 16) {
        throw new RangeError(`unsupported bit depth: ${depth}`);
    }
    const returnValue = { channels, depth, colorType: internalTypes_1.ColorType.UNKNOWN };
    switch (channels) {
        case 4:
            returnValue.colorType = internalTypes_1.ColorType.TRUECOLOUR_ALPHA;
            break;
        case 3:
            returnValue.colorType = internalTypes_1.ColorType.TRUECOLOUR;
            break;
        case 1:
            returnValue.colorType = internalTypes_1.ColorType.GREYSCALE;
            break;
        case 2:
            returnValue.colorType = internalTypes_1.ColorType.GREYSCALE_ALPHA;
            break;
        default:
            throw new Error('unsupported number of channels');
    }
    return returnValue;
}
function writeDataBytes(data, newData, slotsPerLine, offset) {
    for (let j = 0; j < slotsPerLine; j++) {
        newData.writeByte(data[offset++]);
    }
    return offset;
}
function writeDataUint16(data, newData, slotsPerLine, offset) {
    for (let j = 0; j < slotsPerLine; j++) {
        newData.writeUint16(data[offset++]);
    }
    return offset;
}
//# sourceMappingURL=PngEncoder.js.map