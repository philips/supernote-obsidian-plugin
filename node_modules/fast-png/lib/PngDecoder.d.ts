import { IOBuffer } from 'iobuffer';
import { DecodedPng, DecoderInputType, PngDecoderOptions } from './types';
export default class PngDecoder extends IOBuffer {
    private _checkCrc;
    private _inflator;
    private _png;
    private _end;
    private _hasPalette;
    private _palette;
    private _hasTransparency;
    private _transparency;
    private _compressionMethod;
    private _filterMethod;
    private _interlaceMethod;
    private _colorType;
    constructor(data: DecoderInputType, options?: PngDecoderOptions);
    decode(): DecodedPng;
    private decodeSignature;
    private decodeChunk;
    private decodeIHDR;
    private decodePLTE;
    private decodeIDAT;
    private decodetRNS;
    private decodeiCCP;
    private decodetEXt;
    private decodepHYs;
    private decodeImage;
    private decodeInterlaceNull;
}
