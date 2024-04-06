# canny-edge-detector

  [![NPM version][npm-image]][npm-url]
  [![build status][travis-image]][travis-url]
  [![npm download][download-image]][download-url]

Canny edge detector

## Installation

`$ npm install canny-edge-detector`

## Usage

### cannyEdgeDetector(image[, options])

Find edges in an image using the [Canny algorithm](https://en.wikipedia.org/wiki/Canny_edge_detector).  
Returns a greyscale image with the edges at `options.brightness` value.

__arguments__

* `image` - a greyscale Image
* `options` - an optional object

__options__

* `lowThreshold`: Low threshold for the hysteresis procedure (default: 10).
* `highThreshold`: High threshold for the hysteresis procedure (default: 30).
* `gaussianBlur`: Sigma parameter for the gaussian filter step (default: 1.1).
* `brightness`: Values assigned to each edge pixel on the result image (default: image.maxValue).

## Example

```js
import cannyEdgeDetector from 'canny-edge-detector';
import Image from 'image-js';

Image.load('my-image.png').then((img) => {
  const grey = img.grey();
  const edge = cannyEdgeDetector(grey);
  return edge.save('edge.png');
})
```

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/canny-edge-detector.svg?style=flat-square
[npm-url]: https://npmjs.org/package/canny-edge-detector
[travis-image]: https://img.shields.io/travis/image-js/canny-edge-detector/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/image-js/canny-edge-detector
[download-image]: https://img.shields.io/npm/dm/canny-edge-detector.svg?style=flat-square
[download-url]: https://npmjs.org/package/canny-edge-detector
