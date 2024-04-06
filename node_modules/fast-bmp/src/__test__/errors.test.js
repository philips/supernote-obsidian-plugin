'use strict';

const encode = require('..').encode;

describe('errors', () => {
  it('should throw if width or height are undefined or 0', () => {
    expect(() => {
      encode({
        width: 0,
        height: 10,
        components: 1,
        bitDepth: 1,
        channels: 1,
        data: new Uint8Array(2),
      });
    }).toThrow(/width and height are required/);

    expect(() => {
      encode({
        width: 10,
        components: 1,
        bitDepth: 1,
        channels: 1,
        data: new Uint8Array(2),
      });
    }).toThrow(/width and height are required/);
  });

  it('should throw if bitDepth not 1', () => {
    expect(() => {
      encode({
        width: 10,
        height: 10,
        components: 1,
        channels: 1,
        bitDepth: 8,
        data: new Uint8Array(10),
      });
    }).toThrow(/only bitDepth of 1 is supported/i);
  });
});
