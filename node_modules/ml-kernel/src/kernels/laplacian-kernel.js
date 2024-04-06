'use strict';

const { euclidean } = require('ml-distance-euclidean');

const defaultOptions = {
  sigma: 1
};

class LaplacianKernel {
  constructor(options) {
    options = Object.assign({}, defaultOptions, options);
    this.sigma = options.sigma;
  }

  compute(x, y) {
    const distance = euclidean(x, y);
    return Math.exp(-distance / this.sigma);
  }
}

module.exports = LaplacianKernel;
