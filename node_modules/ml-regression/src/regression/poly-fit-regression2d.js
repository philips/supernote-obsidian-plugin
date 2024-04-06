import { Matrix, SVD } from 'ml-matrix';
import BaseRegression from 'ml-regression-base';

const defaultOptions = {
  order: 2
};
// Implements the Kernel ridge regression algorithm.
// http://www.ics.uci.edu/~welling/classnotes/papers_class/Kernel-Ridge.pdf
export default class PolynomialFitRegression2D extends BaseRegression {
  /**
   * Constructor for the 2D polynomial fitting
   *
   * @param inputs
   * @param outputs
   * @param options
   * @constructor
   */
  constructor(inputs, outputs, options) {
    super();
    if (inputs === true) {
      // reloading model
      this.coefficients = Matrix.columnVector(outputs.coefficients);
      this.order = outputs.order;
      if (outputs.r) {
        this.r = outputs.r;
        this.r2 = outputs.r2;
      }
      if (outputs.chi2) {
        this.chi2 = outputs.chi2;
      }
    } else {
      options = Object.assign({}, defaultOptions, options);
      this.order = options.order;
      this.coefficients = [];
      this.X = inputs;
      this.y = outputs;

      this.train(this.X, this.y, options);
    }
  }

  /**
   * Function that fits the model given the data(X) and predictions(y).
   * The third argument is an object with the following options:
   * * order: order of the polynomial to fit.
   *
   * @param {Matrix} X - A matrix with n rows and 2 columns.
   * @param {Matrix} y - A vector of the prediction values.
   */
  train(X, y) {
    if (!Matrix.isMatrix(X)) X = new Matrix(X);
    if (!Matrix.isMatrix(y)) y = Matrix.columnVector(y);

    if (y.rows !== X.rows) {
      y = y.transpose();
    }

    if (X.columns !== 2) {
      throw new RangeError(
        `You give X with ${X.columns} columns and it must be 2`
      );
    }
    if (X.rows !== y.rows) {
      throw new RangeError('X and y must have the same rows');
    }

    var examples = X.rows;
    var coefficients = ((this.order + 2) * (this.order + 1)) / 2;
    this.coefficients = new Array(coefficients);

    var x1 = X.getColumnVector(0);
    var x2 = X.getColumnVector(1);

    var scaleX1 =
      1.0 /
      x1
        .clone()
        .abs()
        .max();
    var scaleX2 =
      1.0 /
      x2
        .clone()
        .abs()
        .max();
    var scaleY =
      1.0 /
      y
        .clone()
        .abs()
        .max();

    x1.mulColumn(0, scaleX1);
    x2.mulColumn(0, scaleX2);
    y.mulColumn(0, scaleY);

    var A = new Matrix(examples, coefficients);
    var col = 0;

    for (var i = 0; i <= this.order; ++i) {
      var limit = this.order - i;
      for (var j = 0; j <= limit; ++j) {
        var result = powColVector(x1, i).mulColumnVector(powColVector(x2, j));
        A.setColumn(col, result);
        col++;
      }
    }

    var svd = new SVD(A.transpose(), {
      computeLeftSingularVectors: true,
      computeRightSingularVectors: true,
      autoTranspose: false
    });

    var qqs = Matrix.rowVector(svd.diagonal);
    qqs = qqs.apply(function (i, j) {
      if (this.get(i, j) >= 1e-15) this.set(i, j, 1 / this.get(i, j));
      else this.set(i, j, 0);
    });

    var qqs1 = Matrix.zeros(examples, coefficients);
    for (i = 0; i < coefficients; ++i) {
      qqs1.set(i, i, qqs.get(0, i));
    }

    qqs = qqs1;

    var U = svd.rightSingularVectors;
    var V = svd.leftSingularVectors;

    this.coefficients = V.mmul(qqs.transpose())
      .mmul(U.transpose())
      .mmul(y);

    col = 0;

    for (i = 0; i <= coefficients; ++i) {
      limit = this.order - i;
      for (j = 0; j <= limit; ++j) {
        this.coefficients.set(
          col,
          0,
          (this.coefficients.get(col, 0) *
            Math.pow(scaleX1, i) *
            Math.pow(scaleX2, j)) /
            scaleY
        );
        col++;
      }
    }
  }

  _predict(newInputs) {
    var x1 = newInputs[0];
    var x2 = newInputs[1];

    var y = 0;
    var column = 0;

    for (var i = 0; i <= this.order; i++) {
      for (var j = 0; j <= this.order - i; j++) {
        y +=
          Math.pow(x1, i) * Math.pow(x2, j) * this.coefficients.get(column, 0);
        column++;
      }
    }

    return y;
  }

  toJSON() {
    return {
      name: 'polyfit2D',
      order: this.order,
      coefficients: this.coefficients
    };
  }

  static load(json) {
    if (json.name !== 'polyfit2D') {
      throw new TypeError('not a polyfit2D model');
    }
    return new PolynomialFitRegression2D(true, json);
  }
}

/**
 * Function that given a column vector return this: vector^power
 *
 * @param x - Column vector.
 * @param power - Pow number.
 * @return {Suite|Matrix}
 */
function powColVector(x, power) {
  var result = x.clone();
  for (var i = 0; i < x.rows; ++i) {
    result.set(i, 0, Math.pow(result.get(i, 0), power));
  }
  return result;
}
