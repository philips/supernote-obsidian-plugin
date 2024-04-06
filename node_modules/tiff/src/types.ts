import { IOBuffer } from 'iobuffer';

export type BufferType = ArrayBufferLike | ArrayBufferView | IOBuffer | Buffer;

export interface IDecodeOptions {
  ignoreImageData?: boolean;
  onlyFirst?: boolean;
}

export type IFDKind = 'standard' | 'exif' | 'gps';

export type DataArray = Uint8Array | Uint16Array | Float32Array;
