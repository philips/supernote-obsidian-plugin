'use strict';

const defaultByteLength = 1024 * 8;
const charArray = [];

class IOBuffer {
    constructor(data, options) {
        options = options || {};
        if (data === undefined) {
            data = defaultByteLength;
        }
        if (typeof data === 'number') {
            data = new ArrayBuffer(data);
        }
        let length = data.byteLength;
        const offset = options.offset ? options.offset>>>0 : 0;
        if (data.buffer) {
            length = data.byteLength - offset;
            if (data.byteLength !== data.buffer.byteLength) { // Node.js buffer from pool
                data = data.buffer.slice(data.byteOffset + offset, data.byteOffset + data.byteLength);
            } else if (offset) {
                data = data.buffer.slice(offset);
            } else {
                data = data.buffer;
            }
        }
        this.buffer = data;
        this.length = length;
        this.byteLength = length;
        this.byteOffset = 0;
        this.offset = 0;
        this.littleEndian = true;
        this._data = new DataView(this.buffer);
        this._increment = length || defaultByteLength;
        this._mark = 0;
    }

    available(byteLength) {
        if (byteLength === undefined) byteLength = 1;
        return (this.offset + byteLength) <= this.length;
    }

    isLittleEndian() {
        return this.littleEndian;
    }

    setLittleEndian() {
        this.littleEndian = true;
    }

    isBigEndian() {
        return !this.littleEndian;
    }

    setBigEndian() {
        this.littleEndian = false;
    }

    skip(n) {
        if (n === undefined) n = 1;
        this.offset += n;
    }

    seek(offset) {
        this.offset = offset;
    }

    mark() {
        this._mark = this.offset;
    }

    reset() {
        this.offset = this._mark;
    }

    rewind() {
        this.offset = 0;
    }

    ensureAvailable(byteLength) {
        if (byteLength === undefined) byteLength = 1;
        if (!this.available(byteLength)) {
            const newIncrement = this._increment + this._increment;
            this._increment = newIncrement;
            const newLength = this.length + newIncrement;
            const newArray = new Uint8Array(newLength);
            newArray.set(new Uint8Array(this.buffer));
            this.buffer = newArray.buffer;
            this.length = newLength;
            this._data = new DataView(this.buffer);
        }
    }

    readBoolean() {
        return this.readUint8() !== 0;
    }

    readInt8() {
        return this._data.getInt8(this.offset++);
    }

    readUint8() {
        return this._data.getUint8(this.offset++);
    }

    readByte() {
        return this.readUint8();
    }

    readBytes(n) {
        if (n === undefined) n = 1;
        var bytes = new Uint8Array(n);
        for (var i = 0; i < n; i++) {
            bytes[i] = this.readByte();
        }
        return bytes;
    }

    readInt16() {
        var value = this._data.getInt16(this.offset, this.littleEndian);
        this.offset += 2;
        return value;
    }

    readUint16() {
        var value = this._data.getUint16(this.offset, this.littleEndian);
        this.offset += 2;
        return value;
    }

    readInt32() {
        var value = this._data.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        return value;
    }

    readUint32() {
        var value = this._data.getUint32(this.offset, this.littleEndian);
        this.offset += 4;
        return value;
    }

    readFloat32() {
        var value = this._data.getFloat32(this.offset, this.littleEndian);
        this.offset += 4;
        return value;
    }

    readFloat64() {
        var value = this._data.getFloat64(this.offset, this.littleEndian);
        this.offset += 8;
        return value;
    }

    readChar() {
        return String.fromCharCode(this.readInt8());
    }

    readChars(n) {
        if (n === undefined) n = 1;
        charArray.length = n;
        for (var i = 0; i < n; i++) {
            charArray[i] = this.readChar();
        }
        return charArray.join('');
    }

    writeBoolean(bool) {
        this.writeUint8(bool ? 0xff : 0x00);
    }

    writeInt8(value) {
        this.ensureAvailable(1);
        this._data.setInt8(this.offset++, value);
    }

    writeUint8(value) {
        this.ensureAvailable(1);
        this._data.setUint8(this.offset++, value);
    }

    writeByte(value) {
        this.writeUint8(value);
    }

    writeBytes(bytes) {
        this.ensureAvailable(bytes.length);
        for (var i = 0; i < bytes.length; i++) {
            this._data.setUint8(this.offset++, bytes[i]);
        }
    }

    writeInt16(value) {
        this.ensureAvailable(2);
        this._data.setInt16(this.offset, value, this.littleEndian);
        this.offset += 2;
    }

    writeUint16(value) {
        this.ensureAvailable(2);
        this._data.setUint16(this.offset, value, this.littleEndian);
        this.offset += 2;
    }

    writeInt32(value) {
        this.ensureAvailable(4);
        this._data.setInt32(this.offset, value, this.littleEndian);
        this.offset += 4;
    }

    writeUint32(value) {
        this.ensureAvailable(4);
        this._data.setUint32(this.offset, value, this.littleEndian);
        this.offset += 4;
    }

    writeFloat32(value) {
        this.ensureAvailable(4);
        this._data.setFloat32(this.offset, value, this.littleEndian);
        this.offset += 4;
    }

    writeFloat64(value) {
        this.ensureAvailable(8);
        this._data.setFloat64(this.offset, value, this.littleEndian);
        this.offset += 8;
    }

    writeChar(str) {
        this.writeUint8(str.charCodeAt(0));
    }

    writeChars(str) {
        for (var i = 0; i < str.length; i++) {
            this.writeUint8(str.charCodeAt(i));
        }
    }

    toArray() {
        return new Uint8Array(this.buffer, 0, this.offset);
    }
}

module.exports = IOBuffer;
