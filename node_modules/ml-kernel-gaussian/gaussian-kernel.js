'use strict';

const { squaredEuclidean } = require('ml-distance-euclidean');

const defaultOptions = {
  sigma: 1
};

class GaussianKernel {
  constructor(options) {
    options = Object.assign({}, defaultOptions, options);
    this.sigma = options.sigma;
    this.divisor = 2 * options.sigma * options.sigma;
  }
  compute(x, y) {
    const distance = squaredEuclidean(x, y);
    return Math.exp(-distance / this.divisor);
  }
}

module.exports = GaussianKernel;
