'use strict';

class HistogramIntersectionKernel {
  compute(x, y) {
    var min = Math.min(x.length, y.length);
    var sum = 0;
    for (var i = 0; i < min; ++i) {
      sum += Math.min(x[i], y[i]);
    }

    return sum;
  }
}

module.exports = HistogramIntersectionKernel;
