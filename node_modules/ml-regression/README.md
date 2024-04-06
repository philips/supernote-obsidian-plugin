# ml-regression

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![npm download][download-image]][download-url]

Regression algorithms.

## Installation

`$ npm install ml-regression`

## Examples

### Simple linear regression

```js
const SLR = require('ml-regression').SLR;
let inputs = [80, 60, 10, 20, 30];
let outputs = [20, 40, 30, 50, 60];

let regression = new SLR(inputs, outputs);
regression.toString(3) === 'f(x) = - 0.265 * x + 50.6';
```

#### External links

Check this cool blog post for a detailed example:
https://hackernoon.com/machine-learning-with-javascript-part-1-9b97f3ed4fe5

### Polynomial regression

```js
const PolynomialRegression = require('ml-regression').PolynomialRegression;
const x = [50, 50, 50, 70, 70, 70, 80, 80, 80, 90, 90, 90, 100, 100, 100];
const y = [3.3, 2.8, 2.9, 2.3, 2.6, 2.1, 2.5, 2.9, 2.4, 3.0, 3.1, 2.8, 3.3, 3.5, 3.0];
const degree = 5; // setup the maximum degree of the polynomial
const regression = new PolynomialRegression(x, y, degree);
console.log(regression.predict(80)); // Apply the model to some x value. Prints 2.6.
console.log(regression.coefficients); // Prints the coefficients in increasing order of power (from 0 to degree).
console.log(regression.toString(3)); // Prints a human-readable version of the function.
console.log(regression.toLaTeX());
```

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-regression.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-regression
[travis-image]: https://img.shields.io/travis/mljs/regression/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/mljs/regression
[download-image]: https://img.shields.io/npm/dm/ml-regression.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-regression
