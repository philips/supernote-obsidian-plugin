# tiff

TIFF image decoder written entirely in JavaScript.

<h3 align="center">

  <a href="https://www.zakodium.com">
    <img src="https://www.zakodium.com/brand/zakodium-logo-white.svg" width="50" alt="Zakodium logo" />
  </a>

  <p>
    Maintained by <a href="https://www.zakodium.com">Zakodium</a>
  </p>

  [![NPM version][npm-image]][npm-url]
  [![build status][ci-image]][ci-url]
  [![npm download][download-image]][download-url]

</h3>

## Installation

```console
npm i tiff
```

## Compatibility

### [TIFF standard](./TIFF6.pdf)

The library can currently decode greyscale and RGB images (8, 16 or 32 bits).
It supports LZW compression and images with an additional alpha channel.

### Extensions

Images compressed with Zlib/deflate algorithm are also supported.

## API

### tiff.decode(data[, options])

Decodes the file and returns TIFF IFDs.

#### IFD object

Each decoded image is stored in an `IFD`.

##### IFD#data

The `data` property is a Typed Array containing the pixel data. It is a
`Uint8Array` for 8bit images, a `Uint16Array` for 16bit images and a
`Float32Array` for 32bit images.

##### Other properties of IFD

- `size` - number of pixels
- `width` - number of columns
- `height` - number of rows
- `bitsPerSample` - bit depth
- `alpha` - `true` if the image has an additional alpha channel
- `xResolution`
- `yResolution`
- `resolutionUnit`

### tiff.pageCount(data)

Returns the number of IFDs (pages) in the file.

### tiff.isMultiPage(data)

Returns true if the file has 2 or more IFDs (pages) and false if it has 1.
This is slightly more efficient than calling `pageCount()` if all you need to
know is whether the file has multiple pages or not.

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/tiff.svg
[npm-url]: https://www.npmjs.com/package/tiff
[ci-image]: https://github.com/image-js/tiff/workflows/Node.js%20CI/badge.svg?branch=master
[ci-url]: https://github.com/image-js/tiff/actions?query=workflow%3A%22Node.js+CI%22
[codecov-image]: https://img.shields.io/codecov/c/github/image-js/tiff.svg
[codecov-url]: https://codecov.io/gh/image-js/tiff
[download-image]: https://img.shields.io/npm/dm/tiff.svg
[download-url]: https://www.npmjs.com/package/tiff
