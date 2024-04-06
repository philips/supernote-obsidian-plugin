# fast-bmp

[![NPM version][npm-image]][npm-url]
[![Test coverage][codecov-image]][codecov-url]
[![npm download][download-image]][download-url]

A library for encoding bmp image file format.

# Supported features

For now there is only support for 1-bit image encoding.

# Usage

```js
const bmp = require('fast-bmp');

// 0 0 0 0 0
// 0 1 1 1 0
// 0 1 0 1 0
// 0 1 1 1 0
// 0 0 0 0 0
const imageData = {
  width: 5,
  height: 5,
  data: new Uint8Array([0b00000011, 0b10010100, 0b11100000, 0b00000000]),
  bitDepth: 1,
  components: 1,
  channels: 1,
};
// Encode returns a Uint8Array.
const encoded = bmp.encode(imageData);
fs.writeFileSync('image.bmp', encoded);
```

[npm-image]: https://img.shields.io/npm/v/fast-bmp.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/fast-bmp
[codecov-image]: https://img.shields.io/codecov/c/github/image-js/fast-bmp.svg?style=flat-square
[codecov-url]: https://codecov.io/gh/image-js/fast-bmp
[download-image]: https://img.shields.io/npm/dm/fast-bmp.svg?style=flat-square
[download-url]: https://www.npmjs.com/package/fast-bmp
