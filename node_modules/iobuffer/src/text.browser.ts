// eslint-disable-next-line import/no-unassigned-import
import './text-encoding-polyfill';

export function decode(bytes: Uint8Array, encoding = 'utf8'): string {
  const decoder = new TextDecoder(encoding);
  return decoder.decode(bytes);
}

const encoder = new TextEncoder();

export function encode(str: string): Uint8Array {
  return encoder.encode(str);
}
