# convolution

  [![NPM version][npm-image]][npm-url]
  [![build status][travis-image]][travis-url]
  [![npm download][download-image]][download-url]

Convolution using the FFT or standard algorithm.

## Installation

`$ npm install --save ml-convolution`

## Usage

```js
import {directConvolution} from 'ml-convolution';

const input = [0, 1, 2, 3];
const kernel = [-1, 1, -1];

const output = directConvolution(input, kernel);
// [0, -1, -1, -2, 1, -3]
```

## [API Documentation](https://mljs.github.io/convolution/)

### Benchmark

With small kernels, direct convolution is usually faster:  
Current results suggest that from a kernel size of 512, fft convolution should be used.

| Data x Kernel | fft [ops/s] | direct [ops/s] |
| ------------- | --- | ------ |
| 128 x 16 | 17640 | 256329 |
| 128 x 32 | 17590 | 138211 |
| 128 x 128 | 17295 | 35486 |
| 128 x 512 | 4515 | 9308 |
| 128 x 1024 | 2157 | 4695 |
| 512 x 16 | 4527 | 66017 |
| 512 x 32 | 4556 | 35356 |
| 512 x 128 | 3848 | 8134 |
| 512 x 512 | 3217 | 2311 |
| 512 x 1024 | 2079 | 1072 |
| 2048 x 16 | 681 | 15864 |
| 2048 x 32 | 977 | 8749 |
| 2048 x 128 | 1098 | 2164 |
| 2048 x 512 | 1089 | 591 |
| 2048 x 1024 | 1088 | 298 |
| 4096 x 16 | 473 | 8082 |
| 4096 x 32 | 404 | 4272 |
| 4096 x 128 | 489 | 1128 |
| 4096 x 512 | 510 | 296 |
| 4096 x 1024 | 506 | 149 |
| 16384 x 16 | 80 | 2112 |
| 16384 x 32 | 72 | 1107 |
| 16384 x 128 | 78 | 282 |
| 16384 x 512 | 79 | 74 |
| 16384 x 1024 | 77 | 37 |
| 65536 x 16 | 18 | 491 |
| 65536 x 32 | 18 | 270 |
| 65536 x 128 | 18 | 70 |
| 65536 x 512 | 17 | 18 |
| 65536 x 1024 | 19 | 9 |
| 262144 x 16 | 4 | 125 |
| 262144 x 32 | 4 | 67 |
| 262144 x 128 | 4 | 17 |
| 262144 x 512 | 4 | 5 |
| 262144 x 1024 | 4 | 2 |
| 1048576 x 16 | 1 | 31 |
| 1048576 x 32 | 1 | 15 |
| 1048576 x 128 | 1 | 4 |
| 1048576 x 512 | 1 | 1 |
| 1048576 x 1024 | 1 | 1 |

## License

  [MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-convolution.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-convolution
[travis-image]: https://img.shields.io/travis/mljs/convolution/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/mljs/convolution
[download-image]: https://img.shields.io/npm/dm/ml-convolution.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-convolution
