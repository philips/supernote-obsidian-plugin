# regression-theil-sen

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![npm download][download-image]][download-url]

Method for robust fitting a line to a set of points.

## Installation

`$ npm i ml-regression-theil-sen`

## Usage

```js
import TheilSenRegression from 'ml-regression-theil-sen';

var inputs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
var outputs = [2, 3, 4, 20, 6, 7, 8, 9, 10];

var regression = new TheilSenRegression(inputs, outputs);
var y = regression.predict(85);

y === 85;
regression.toString(3) === 'f(x) = x + 1.00';
```

## [API Documentation](https://mljs.github.io/regression-theil-sen/)

The method is well explained on [this article](https://en.wikipedia.org/wiki/Theil%E2%80%93Sen_estimator).

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-regression-theil-sen.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-regression-theil-sen
[travis-image]: https://img.shields.io/travis/mljs/regression-theil-sen/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/mljs/regression-theil-sen
[download-image]: https://img.shields.io/npm/dm/ml-regression-theil-sen.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-regression-theil-sen
