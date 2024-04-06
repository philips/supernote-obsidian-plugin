'use strict';

const defaultOptions = {
  degree: 1,
  constant: 1,
  scale: 1
};

class PolynomialKernel {
  constructor(options) {
    options = Object.assign({}, defaultOptions, options);

    this.degree = options.degree;
    this.constant = options.constant;
    this.scale = options.scale;
  }

  compute(x, y) {
    var sum = 0;
    for (var i = 0; i < x.length; i++) {
      sum += x[i] * y[i];
    }
    return Math.pow(this.scale * sum + this.constant, this.degree);
  }
}

module.exports = PolynomialKernel;
