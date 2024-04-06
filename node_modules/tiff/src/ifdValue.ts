import TIFFDecoder from './tiffDecoder';

let types = new Map<
  number,
  [number, (decoder: TIFFDecoder, count: number) => any]
>([
  [1, [1, readByte]], // BYTE
  [2, [1, readASCII]], // ASCII
  [3, [2, readShort]], // SHORT
  [4, [4, readLong]], // LONG
  [5, [8, readRational]], // RATIONAL
  [6, [1, readSByte]], // SBYTE
  [7, [1, readByte]], // UNDEFINED
  [8, [2, readSShort]], // SSHORT
  [9, [4, readSLong]], // SLONG
  [10, [8, readSRational]], // SRATIONAL
  [11, [4, readFloat]], // FLOAT
  [12, [8, readDouble]], // DOUBLE
]);

export function getByteLength(type: number, count: number): number {
  const val = types.get(type);
  if (!val) throw new Error(`type not found: ${type}`);
  return val[0] * count;
}

export function readData(
  decoder: TIFFDecoder,
  type: number,
  count: number,
): any {
  const val = types.get(type);
  if (!val) throw new Error(`type not found: ${type}`);
  return val[1](decoder, count);
}

function readByte(decoder: TIFFDecoder, count: number): number | Uint8Array {
  if (count === 1) return decoder.readUint8();
  let array = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readUint8();
  }
  return array;
}

function readASCII(decoder: TIFFDecoder, count: number): string | string[] {
  let strings = [];
  let currentString = '';
  for (let i = 0; i < count; i++) {
    let char = String.fromCharCode(decoder.readUint8());
    if (char === '\0') {
      strings.push(currentString);
      currentString = '';
    } else {
      currentString += char;
    }
  }
  if (strings.length === 1) {
    return strings[0];
  } else {
    return strings;
  }
}

function readShort(decoder: TIFFDecoder, count: number): number | Uint16Array {
  if (count === 1) return decoder.readUint16();
  let array = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readUint16();
  }
  return array;
}

function readLong(decoder: TIFFDecoder, count: number): number | Uint32Array {
  if (count === 1) return decoder.readUint32();
  let array = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readUint32();
  }
  return array;
}

function readRational(decoder: TIFFDecoder, count: number): number | number[] {
  if (count === 1) {
    return decoder.readUint32() / decoder.readUint32();
  }
  let rationals = new Array(count);
  for (let i = 0; i < count; i++) {
    rationals[i] = decoder.readUint32() / decoder.readUint32();
  }
  return rationals;
}

function readSByte(decoder: TIFFDecoder, count: number): number | Int8Array {
  if (count === 1) return decoder.readInt8();
  let array = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readInt8();
  }
  return array;
}

function readSShort(decoder: TIFFDecoder, count: number): number | Int16Array {
  if (count === 1) return decoder.readInt16();
  let array = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readInt16();
  }
  return array;
}

function readSLong(decoder: TIFFDecoder, count: number): number | Int32Array {
  if (count === 1) return decoder.readInt32();
  let array = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readInt32();
  }
  return array;
}

function readSRational(decoder: TIFFDecoder, count: number): number | number[] {
  if (count === 1) {
    return decoder.readInt32() / decoder.readInt32();
  }
  let rationals = new Array(count);
  for (let i = 0; i < count; i++) {
    rationals[i] = decoder.readInt32() / decoder.readInt32();
  }
  return rationals;
}

function readFloat(decoder: TIFFDecoder, count: number): number | Float32Array {
  if (count === 1) return decoder.readFloat32();
  let array = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readFloat32();
  }
  return array;
}

function readDouble(
  decoder: TIFFDecoder,
  count: number,
): number | Float64Array {
  if (count === 1) return decoder.readFloat64();
  let array = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = decoder.readFloat64();
  }
  return array;
}
