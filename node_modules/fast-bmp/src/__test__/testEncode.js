'use strict';

const fs = require('fs');
const path = require('path');

const { expect } = require('@jest/globals');

const encode = require('..').encode;

module.exports = function testEncode(data, filename) {
  const buffer = encode(data);
  if (process.env.FAST_BMP_WRITE_DATA_FILES) {
    fs.writeFileSync(path.join(__dirname, 'files', filename), buffer);
  } else {
    const fileData = fs.readFileSync(path.join(__dirname, 'files', filename));
    const fileDataUint8 = Uint8Array.from(fileData);
    expect(buffer).toStrictEqual(fileDataUint8);
  }
};
