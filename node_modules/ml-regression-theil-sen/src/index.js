import BaseRegression, {
  checkArrayLength,
  maybeToPrecision
} from 'ml-regression-base';
import median from 'ml-array-median';

export default class TheilSenRegression extends BaseRegression {
  /**
   * Theil–Sen estimator
   * https://en.wikipedia.org/wiki/Theil%E2%80%93Sen_estimator
   * @param {Array<number>|boolean} x
   * @param {Array<number>|object} y
   * @constructor
   */
  constructor(x, y) {
    super();
    if (x === true) {
      // loads the model
      this.slope = y.slope;
      this.intercept = y.intercept;
      this.coefficients = y.coefficients;
    } else {
      // creates the model
      checkArrayLength(x, y);
      theilSen(this, x, y);
    }
  }

  toJSON() {
    return {
      name: 'TheilSenRegression',
      slope: this.slope,
      intercept: this.intercept
    };
  }

  _predict(input) {
    return this.slope * input + this.intercept;
  }

  computeX(input) {
    return (input - this.intercept) / this.slope;
  }

  toString(precision) {
    var result = 'f(x) = ';
    if (this.slope) {
      var xFactor = maybeToPrecision(this.slope, precision);
      result += `${Math.abs(xFactor - 1) < 1e-5 ? '' : `${xFactor} * `}x`;
      if (this.intercept) {
        var absIntercept = Math.abs(this.intercept);
        var operator = absIntercept === this.intercept ? '+' : '-';
        result +=
          ` ${operator} ${maybeToPrecision(absIntercept, precision)}`;
      }
    } else {
      result += maybeToPrecision(this.intercept, precision);
    }
    return result;
  }

  toLaTeX(precision) {
    return this.toString(precision);
  }

  static load(json) {
    if (json.name !== 'TheilSenRegression') {
      throw new TypeError('not a Theil-Sen model');
    }
    return new TheilSenRegression(true, json);
  }
}

function theilSen(regression, x, y) {
  let len = x.length;
  let slopes = new Array(len * len);
  let count = 0;
  for (let i = 0; i < len; ++i) {
    for (let j = i + 1; j < len; ++j) {
      if (x[i] !== x[j]) {
        slopes[count++] = (y[j] - y[i]) / (x[j] - x[i]);
      }
    }
  }
  slopes.length = count;
  let medianSlope = median(slopes);

  let cuts = new Array(len);
  for (let i = 0; i < len; ++i) {
    cuts[i] = y[i] - medianSlope * x[i];
  }

  regression.slope = medianSlope;
  regression.intercept = median(cuts);
  regression.coefficients = [regression.intercept, regression.slope];
}
