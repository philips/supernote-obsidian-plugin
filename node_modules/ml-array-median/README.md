# array-median

  [![NPM version][npm-image]][npm-url]
  [![npm download][download-image]][download-url]

Get the median value in an array, this median use the [Floyd-Rivest algorithm](https://en.wikipedia.org/wiki/Floyd%E2%80%93Rivest_algorithm).

Thanks to [mad-gooze](https://github.com/mad-gooze) for his median-quickselect [lib](https://github.com/mad-gooze/median-quickselect).

Some benchmarks [here](https://jsperf.com/median-inplace/1).


## Installation

`$ npm install --save ml-array-median`

## Usage

```js
import median from 'ml-array-median';

const result = median([1, 5, 3, 2, 4]);
// 3
```

## License

  [MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-array-median.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-array-median
[download-image]: https://img.shields.io/npm/dm/ml-array-median.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-array-median