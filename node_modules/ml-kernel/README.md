# ml-kernel

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![npm download][download-image]][download-url]

A factory for kernel functions.

## Installation

`$ npm i ml-kernel`

## Usage

### new Kernel(type, options)

This function can be called with a matrix of input vectors.
and optional landmarks. If no landmark is provided, the input vectors will be used.

**Available kernels**:

- `linear` - Linear kernel
- `gaussian` or `rbf` - [Gaussian (radial basis function) kernel](https://github.com/mljs/kernel-gaussian)
- `polynomial` or `poly` - [Polynomial kernel](https://github.com/mljs/kernel-polynomial)
- `exponential` - [Exponential kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#exponential)
- `laplacian` - [Laplacian kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#laplacian)
- `anova` - [ANOVA kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#anova)
- `rational` - [Rational Quadratic kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#rational)
- `multiquadratic` - [Multiquadratic kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#multiquadric)
- `cauchy` - [Cauchy kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#cauchy)
- `histogram` or `min` - [Histogram Intersection kernel](http://crsouza.com/2010/03/kernel-functions-for-machine-learning-applications/#histogram)
- `sigmoid` or `mlp' - [Sigmoid (hyperbolic tangent) kernel](https://github.com/mljs/kernel-sigmoid)

### kernel.compute(inputs, landmarks)

This function can be called with a matrix of input vectors and optional landmarks.
If no landmark is provided, the input vectors will be used.  
The function returns a kernel matrix of feature space vectors.

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-kernel.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-kernel
[travis-image]: https://img.shields.io/travis/mljs/kernel/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/mljs/kernel
[download-image]: https://img.shields.io/npm/dm/ml-kernel.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-kernel
