import { IOBuffer } from 'iobuffer';
import { PngEncoderOptions, ImageData } from './types';
export default class PngEncoder extends IOBuffer {
    private _png;
    private _zlibOptions;
    private _colorType;
    constructor(data: ImageData, options?: PngEncoderOptions);
    encode(): Uint8Array;
    private encodeSignature;
    private encodeIHDR;
    private encodeIEND;
    private encodeIDAT;
    private encodeData;
    private _checkData;
    private writeCrc;
}
