# monotone-chain-convex-hull

[![NPM version][npm-image]][npm-url]
[![npm download][download-image]][download-url]

Monotone Chain Convex Hull algorithm.

## Installation

`$ npm install --save monotone-chain-convex-hull`

## Usage

```js
import monotoneChainConvexHull from 'monotone-chain-convex-hull';

const result = monotoneChainConvexHull([
  [1, 1],
  [3, 0],
  [2, 1],
  [3, 2],
  [1, 2],
  [0, 2],
  [0, 0],
]);
// result is [[0, 0], [0, 2], [3, 2], [3, 0]]
```

## [API Documentation](https://image-js.github.io/monotone-chain-convex-hull/)

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/monotone-chain-convex-hull.svg?style=flat-square
[npm-url]: https://npmjs.org/package/monotone-chain-convex-hull
[download-image]: https://img.shields.io/npm/dm/monotone-chain-convex-hull.svg?style=flat-square
[download-url]: https://npmjs.org/package/monotone-chain-convex-hull
