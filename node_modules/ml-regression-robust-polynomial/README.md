# regression-robust-polynomial

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![npm download][download-image]][download-url]

Robust polynomial regression using LMedS.

This code is based on the implementation of [this paper](https://doi.org/10.1007/BF00127126).

## Installation

`$ npm i ml-regression-robust-polynomial`

## Usage

```js
import RobustPolynomialRegression from 'ml-regression-robust-polynomial';

var size = 30;
var x = new Array(size);
var y = new Array(size);
for (var i = 0; i < size; i++) {
  x[i] = i;
  y[i] = 2 * i * i + 4 * i + 5;
}
y[4] = y[4] * 100;
y[10] = y[10] * -100;

var regression = new RobustPolynomialRegression(x, y, 3);

regression.predict(3) === 35;
```

## [API Documentation](https://mljs.github.io/regression-robust-polynomial/)

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-regression-robust-polynomial.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-regression-robust-polynomial
[travis-image]: https://img.shields.io/travis/mljs/regression-robust-polynomial/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/mljs/regression-robust-polynomial
[codecov-image]: https://img.shields.io/codecov/c/github/mljs/regression-robust-polynomial.svg?style=flat-square
[codecov-url]: https://codecov.io/gh/mljs/regression-robust-polynomial
[download-image]: https://img.shields.io/npm/dm/ml-regression-robust-polynomial.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-regression-robust-polynomial
