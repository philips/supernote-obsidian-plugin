# iobuffer

Read and write binary data in ArrayBuffers.

<h3 align="center">

  <a href="https://www.zakodium.com">
    <img src="https://www.zakodium.com/brand/zakodium-logo-white.svg" width="50" alt="Zakodium logo" />
  </a>

  <p>
    Maintained by <a href="https://www.zakodium.com">Zakodium</a>
  </p>
  
  [![NPM version][npm-image]][npm-url]
  [![build status][ci-image]][ci-url]
  [![Test coverage][codecov-image]][codecov-url]
  [![npm download][download-image]][download-url]

</h3>

## Installation

```console
npm i iobuffer
```

## API

Complete [API documentation](http://image-js.github.io/iobuffer/)

## Usage example

```js
const { IOBuffer } = require('iobuffer');

const io = new IOBuffer();
// Pointer offset is 0
io.writeChars('Hello world') // Write 11 chars, pointer offset now 11
  .writeUint32(42) // Write 32-bit int (default is little-endian), pointer offset now 15
  .setBigEndian() // Switch to big-endian mode
  .writeUint32(24) // Write another 32-bit int, but big-endian, pointer offset now 19
  .mark() // Bookmark current pointer offset (19)
  .skip(2) // Pointer offset now 21
  .writeBoolean(true) // Write 0xff, pointer offset now 22
  .reset() // Go to bookmarked pointer offset, pointer offset now 19
  .setLittleEndian() // Go back to little endian mode
  .writeUint16(18) // Write 16-bit unsigned integer in the previously skipped 2 bytes, pointer offset now 21
  .rewind() // Pointer offset back to 0
  .toArray(); // Get a Uint8Array over the written part [0-21] of the internal ArrayBuffer
```

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/iobuffer.svg
[npm-url]: https://www.npmjs.com/package/iobuffer
[ci-image]: https://github.com/image-js/iobuffer/workflows/Node.js%20CI/badge.svg?branch=main
[ci-url]: https://github.com/image-js/iobuffer/actions?query=workflow%3A%22Node.js+CI%22
[codecov-image]: https://img.shields.io/codecov/c/github/image-js/iobuffer.svg
[codecov-url]: https://codecov.io/gh/image-js/iobuffer
[download-image]: https://img.shields.io/npm/dm/iobuffer.svg
[download-url]: https://www.npmjs.com/package/iobuffer
