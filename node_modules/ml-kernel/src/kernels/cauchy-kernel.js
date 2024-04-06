'use strict';

const { squaredEuclidean } = require('ml-distance-euclidean');

const defaultOptions = {
  sigma: 1
};

class CauchyKernel {
  constructor(options) {
    options = Object.assign({}, defaultOptions, options);
    this.sigma = options.sigma;
  }

  compute(x, y) {
    return 1 / (1 + squaredEuclidean(x, y) / (this.sigma * this.sigma));
  }
}

module.exports = CauchyKernel;
