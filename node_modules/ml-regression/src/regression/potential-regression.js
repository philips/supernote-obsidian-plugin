import BaseRegression, { maybeToPrecision } from 'ml-regression-base';
import PolynomialRegression from 'ml-regression-polynomial';


/*
 * Function that calculate the potential fit in the form f(x) = A*x^M
 * with a given M and return de A coefficient.
 *
 * @param {Vector} X - Vector of the x positions of the points.
 * @param {Vector} Y - Vector of the x positions of the points.
 * @param {Number} M - The exponent of the potential fit.
 * @return {Number} A - The A coefficient of the potential fit.
 */
export default class PotentialRegression extends BaseRegression {
  /**
   * @constructor
   * @param x: Independent variable
   * @param y: Dependent variable
   * @param M
   */
  constructor(x, y, M) {
    super();
    if (x === true) {
      // reloading model
      this.A = y.A;
      this.M = y.M;
    } else {
      var n = x.length;
      if (n !== y.length) {
        throw new RangeError('input and output array have a different length');
      }

      var linear = new PolynomialRegression(x, y, [M]);
      this.A = linear.coefficients[0];
      this.M = M;
    }
  }

  _predict(x) {
    return this.A * Math.pow(x, this.M);
  }

  toJSON() {
    return {
      name: 'potentialRegression',
      A: this.A,
      M: this.M
    };
  }

  toString(precision) {
    return `f(x) = ${maybeToPrecision(this.A, precision)} * x^${this.M}`;
  }

  toLaTeX(precision) {
    if (this.M >= 0) {
      return (
        `f(x) = ${maybeToPrecision(this.A, precision)}x^{${this.M}}`
      );
    } else {
      return (
        `f(x) = \\frac{${
          maybeToPrecision(this.A, precision)
        }}{x^{${
          -this.M
        }}}`
      );
    }
  }

  static load(json) {
    if (json.name !== 'potentialRegression') {
      throw new TypeError('not a potential regression model');
    }
    return new PotentialRegression(true, json);
  }
}
