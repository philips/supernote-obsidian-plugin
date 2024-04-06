import BaseRegression, {
  checkArrayLength,
  maybeToPrecision
} from 'ml-regression-base';
import SimpleLinearRegression from 'ml-regression-simple-linear';

export default class PowerRegression extends BaseRegression {
  constructor(x, y) {
    super();
    if (x === true) {
      // reloading model
      this.A = y.A;
      this.B = y.B;
    } else {
      checkArrayLength(x, y);
      regress(this, x, y);
    }
  }

  _predict(newInputs) {
    return this.A * Math.pow(newInputs, this.B);
  }

  toJSON() {
    return {
      name: 'powerRegression',
      A: this.A,
      B: this.B
    };
  }

  toString(precision) {
    return `f(x) = ${maybeToPrecision(
      this.A,
      precision
    )} * x^${maybeToPrecision(this.B, precision)}`;
  }

  toLaTeX(precision) {
    let latex = '';
    if (this.B >= 0) {
      latex = `f(x) = ${maybeToPrecision(
        this.A,
        precision
      )}x^{${maybeToPrecision(this.B, precision)}}`;
    } else {
      latex = `f(x) = \\frac{${maybeToPrecision(
        this.A,
        precision
      )}}{x^{${maybeToPrecision(-this.B, precision)}}}`;
    }
    latex = latex.replace(/e([+-]?[0-9]+)/g, 'e^{$1}');
    return latex;
  }

  static load(json) {
    if (json.name !== 'powerRegression') {
      throw new TypeError('not a power regression model');
    }
    return new PowerRegression(true, json);
  }
}

function regress(pr, x, y) {
  const n = x.length;
  const xl = new Array(n);
  const yl = new Array(n);
  for (let i = 0; i < n; i++) {
    xl[i] = Math.log(x[i]);
    yl[i] = Math.log(y[i]);
  }

  const linear = new SimpleLinearRegression(xl, yl);
  pr.A = Math.exp(linear.intercept);
  pr.B = linear.slope;
}
