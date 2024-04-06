"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decompressLzw = void 0;
const iobuffer_1 = require("iobuffer");
const CLEAR_CODE = 256;
const EOI_CODE = 257;
// 0-255 from the table + 256 for clear code + 257 for end of information code.
const TABLE_START = 258;
const MIN_BIT_LENGTH = 9;
let stringTable = [];
function initializeStringTable() {
    if (stringTable.length === 0) {
        for (let i = 0; i < 256; i++) {
            stringTable.push([i]);
        }
        // Fill the table with dummy data.
        // Elements at indices > 257 will be replaced during decompression.
        const dummyString = [];
        for (let i = 256; i < 4096; i++) {
            stringTable.push(dummyString);
        }
    }
}
const andTable = [511, 1023, 2047, 4095];
const bitJumps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 1023, 2047, 4095];
class LzwDecoder {
    constructor(data) {
        this.nextData = 0;
        this.nextBits = 0;
        this.bytePointer = 0;
        this.tableLength = TABLE_START;
        this.currentBitLength = MIN_BIT_LENGTH;
        this.stripArray = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.outData = new iobuffer_1.IOBuffer(data.byteLength);
        this.initializeTable();
    }
    decode() {
        let code = 0;
        let oldCode = 0;
        while ((code = this.getNextCode()) !== EOI_CODE) {
            if (code === CLEAR_CODE) {
                this.initializeTable();
                code = this.getNextCode();
                if (code === EOI_CODE) {
                    break;
                }
                this.writeString(this.stringFromCode(code));
                oldCode = code;
            }
            else if (this.isInTable(code)) {
                this.writeString(this.stringFromCode(code));
                this.addStringToTable(this.stringFromCode(oldCode).concat(this.stringFromCode(code)[0]));
                oldCode = code;
            }
            else {
                const outString = this.stringFromCode(oldCode).concat(this.stringFromCode(oldCode)[0]);
                this.writeString(outString);
                this.addStringToTable(outString);
                oldCode = code;
            }
        }
        const outArray = this.outData.toArray();
        return new DataView(outArray.buffer, outArray.byteOffset, outArray.byteLength);
    }
    initializeTable() {
        initializeStringTable();
        this.tableLength = TABLE_START;
        this.currentBitLength = MIN_BIT_LENGTH;
    }
    writeString(string) {
        this.outData.writeBytes(string);
    }
    stringFromCode(code) {
        // At this point, `code` must be defined in the table.
        return stringTable[code];
    }
    isInTable(code) {
        return code < this.tableLength;
    }
    addStringToTable(string) {
        stringTable[this.tableLength++] = string;
        if (stringTable.length > 4096) {
            stringTable = [];
            throw new Error('LZW decoding error. Please open an issue at https://github.com/image-js/tiff/issues/new/choose (include a test image).');
        }
        if (this.tableLength === bitJumps[this.currentBitLength]) {
            this.currentBitLength++;
        }
    }
    getNextCode() {
        this.nextData =
            (this.nextData << 8) | (this.stripArray[this.bytePointer++] & 0xff);
        this.nextBits += 8;
        if (this.nextBits < this.currentBitLength) {
            this.nextData =
                (this.nextData << 8) | (this.stripArray[this.bytePointer++] & 0xff);
            this.nextBits += 8;
        }
        const code = (this.nextData >> (this.nextBits - this.currentBitLength)) &
            andTable[this.currentBitLength - 9];
        this.nextBits -= this.currentBitLength;
        // This should not really happen but is present in other codes as well.
        // See: https://github.com/sugark/Tiffus/blob/15a60123813d1612f4ae9e4fab964f9f7d71cf63/src/org/eclipse/swt/internal/image/TIFFLZWDecoder.java
        if (this.bytePointer > this.stripArray.length) {
            return 257;
        }
        return code;
    }
}
function decompressLzw(stripData) {
    return new LzwDecoder(stripData).decode();
}
exports.decompressLzw = decompressLzw;
//# sourceMappingURL=lzw.js.map