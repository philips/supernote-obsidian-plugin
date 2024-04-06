import { inflate } from 'pako';
export function decompressZlib(stripData) {
    const stripUint8 = new Uint8Array(stripData.buffer, stripData.byteOffset, stripData.byteLength);
    const inflated = inflate(stripUint8);
    return new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}
//# sourceMappingURL=zlib.js.map