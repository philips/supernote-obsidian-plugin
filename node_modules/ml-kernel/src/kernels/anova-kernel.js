'use strict';

const defaultOptions = {
  sigma: 1,
  degree: 1
};

class ANOVAKernel {
  constructor(options) {
    options = Object.assign({}, defaultOptions, options);
    this.sigma = options.sigma;
    this.degree = options.degree;
  }

  compute(x, y) {
    var sum = 0;
    var len = Math.min(x.length, y.length);
    for (var i = 1; i <= len; ++i) {
      sum += Math.pow(
        Math.exp(
          -this.sigma *
            Math.pow(Math.pow(x[i - 1], i) - Math.pow(y[i - 1], i), 2)
        ),
        this.degree
      );
    }
    return sum;
  }
}

module.exports = ANOVAKernel;
