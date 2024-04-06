# tiff-js

  [![NPM version][npm-image]][npm-url]
  [![build status][travis-image]][travis-url]
  [![npm download][download-image]][download-url]

TIFF image decoder written entirely in JavaScript.

## Installation

```
$ npm install tiff
```

## Compatibility

### Platform

This package is written using ES2015 features. It is natively compatible with recent versions of Google Chrome
and Node.js. You can transpile it with a tool like [babel](https://babeljs.io/) if you need to support more
JavaScript engines.

### TIFF standard

Currently, only greyscale images (8, 16 or 32 bits) can be decoded.

## API

The package is in early development and API should be considered unstable.  
I am currently only focused on extending TIFF format support and will work on the API afterwards.

### tiff.decode(data[, options])

Decodes the file and returns TIFF IFDs.

#### IFD object

Each decoded image is stored in an `IFD`.

##### IFD#data

The `data` property is a Typed Array containing the pixel data. It is a `Uint8Array` for 8bit images, a `Uint16Array` for 16bit images and a `Float32Array` for 32bit images.

##### Other properties of IFD

* `size` - number of pixels
* `width` - number of columns
* `height` - number of rows
* `bitsPerSample` - bit depth
* `xResolution`
* `yResolution`
* `resolutionUnit`

## License

  [MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/tiff.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/tiff
[travis-image]: https://img.shields.io/travis/image-js/tiff-js/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/image-js/tiff-js
[download-image]: https://img.shields.io/npm/dm/tiff.svg?style=flat-square
[download-url]: https://www.npmjs.com/package/tiff
