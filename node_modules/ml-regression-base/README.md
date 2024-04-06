# regression-base

[![NPM version][npm-image]][npm-url]
[![build status][ci-image]][ci-url]
[![Test coverage][codecov-image]][codecov-url]
[![npm download][download-image]][download-url]

Base class for regression modules.  
This package is for ml.js internal use.

## Usage

You only have to implement the `_predict` method. It is always called with a number.

The model should be created in the constructor.

Optional methods that can be implemented: `toString`, `toLaTeX`.

```js
import BaseRegression from 'ml-regression-base';

class MyRegression extends BaseRegression {
  constructor(factor) {
    super();
    this.factor = factor;
  }
  _predict(x) {
    return x * this.factor;
  }
  toString() {
    return `f(x) = x * ${this.factor}`;
  }
}
```

### `maybeToPrecision(value, digits)`

Convenience method to transform numbers to readable strings.

If digits is not specified, "value.toString()" is used. Otherwise "value.toPrecision(digits)" is used.

This method can be used to implement `toString()` or `toLaTeX()`.

### `checkArrayLength(x, y)`

Convenience method to check if the input and output arrays passed to a regression
constructor are effectively arrays with the same length.

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-regression-base.svg
[npm-url]: https://npmjs.org/package/ml-regression-base
[codecov-image]: https://img.shields.io/codecov/c/github/mljs/regression-base.svg
[codecov-url]: https://codecov.io/gh/mljs/regression-base
[ci-image]: https://github.com/mljs/regression-base/workflows/Node.js%20CI/badge.svg?branch=master
[ci-url]: https://github.com/mljs/regression-base/actions?query=workflow%3A%22Node.js+CI%22
[download-image]: https://img.shields.io/npm/dm/ml-regression-base.svg
[download-url]: https://npmjs.org/package/ml-regression-base
