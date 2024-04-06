'use strict';

const testEncode = require('./testEncode');

const data = {
  bitDepth: 1,
  components: 1,
  channels: 1,
};
describe('encode image with bitDepth of 1', () => {
  it('encode a 5x5 image', () => {
    // 0 0 0 0 0
    // 0 1 1 1 0
    // 0 1 0 1 0
    // 0 1 1 1 0
    // 0 0 0 0 0
    data.width = 5;
    data.height = 5;
    data.data = new Uint8Array([
      0b000000011, 0b10010100, 0b11100000, 0b00000000,
    ]);
    testEncode(data, '5x5.bmp');
  });

  it('encode a 1x5 image', () => {
    // 0
    // 1
    // 0
    // 1
    // 1
    data.width = 1;
    data.height = 5;
    data.data = new Uint8Array([0b01011111]);
    testEncode(data, '1x5.bmp');
  });

  it('encode a 5x1 image', () => {
    // 1 0 1 0 0
    data.width = 5;
    data.height = 1;
    data.data = new Uint8Array([0b10100111]);
    testEncode(data, '5x1.bmp');
  });

  it('encode a 6x4 image', () => {
    data.width = 6;
    data.height = 4;
    data.data = new Uint8Array([0b11111100, 0b00001111, 0b11000000]);
    testEncode(data, '6x4.bmp');
  });

  it('encode a 62x4', () => {
    data.width = 62;
    data.height = 4;
    data.data = new Uint8Array([
      0b11111111, 0b11111111, 0b11111111, 0b00000000, 0b00000000, 0b11111111,
      0b11111111, 0b11111100, 0b00000000, 0b00000000, 0b00000011, 0b11111111,
      0b11111100, 0b00000000, 0b00000000, 0b00001111, 0b11111111, 0b11111111,
      0b11110000, 0b00000000, 0b000011111, 0b11111111, 0b11111111, 0b11000000,
      0b00000000, 0b00000000, 0b00111111, 0b11111111, 0b11000000, 0b00000000,
      0b00000000,
    ]);
    testEncode(data, '62x4.bmp');
  });

  it('encode a 10x2 image', () => {
    // 1 1 1 0 0 1 0 1 0 1
    // 1 0 1 0 1 0 0 1 1 1
    data.width = 10;
    data.height = 2;
    data.data = new Uint8Array([0b11100101, 0b01101010, 0b01110000]);
    testEncode(data, '10x2.bmp');
  });

  it('encode image with exactly 4 bytes width', () => {
    data.width = 32;
    data.height = 2;
    data.data = new Uint8Array([
      0b00000000, 0b00000000, 0b11111111, 0b11111111, 0b11111111, 0b11111111,
      0b00000000, 0b00000000,
    ]);
    testEncode(data, '32x2.bmp');
  });

  it('encode image with more that 4 bytes width', () => {
    data.width = 42;
    data.height = 2;
    data.data = new Uint8Array([
      0b00000000, 0b00000000, 0b11111111, 0b11111111, 0b11111111, 0b11000000,
      0b00000000, 0b00111111, 0b11111111, 0b11111111, 0b11111111,
    ]);
    testEncode(data, '42x2.bmp');
  });

  it('encode image where skipBit can equal relOffset on the last column', () => {
    data.width = 60;
    data.height = 4;
    data.data = new Uint8Array([
      0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000,
      0b00000000, 0b00000000, 0b11111111, 0b11111111, 0b11111111, 0b11111111,
      0b11111111, 0b11111111, 0b11111111, 0b00000000, 0b00000000, 0b00000000,
      0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b11111111,
      0b11111111, 0b11111111, 0b11111111, 0b11111111, 0b11111111, 0b11111111,
    ]);
    testEncode(data, '60x4.bmp');
  });
});
