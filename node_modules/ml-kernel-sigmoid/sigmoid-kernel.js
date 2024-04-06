'use strict';

const defaultOptions = {
  alpha: 0.01,
  constant: -Math.E
};

class SigmoidKernel {
  constructor(options) {
    options = Object.assign({}, defaultOptions, options);
    this.alpha = options.alpha;
    this.constant = options.constant;
  }

  compute(x, y) {
    var sum = 0;
    for (var i = 0; i < x.length; i++) {
      sum += x[i] * y[i];
    }
    return Math.tanh(this.alpha * sum + this.constant);
  }
}

module.exports = SigmoidKernel;
