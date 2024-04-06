import { Matrix, MatrixTransposeView, solve } from 'ml-matrix';
import BaseRegression, {
  checkArrayLength,
  maybeToPrecision,
} from 'ml-regression-base';

export default class PolynomialRegression extends BaseRegression {
  constructor(x, y, degree) {
    super();
    if (x === true) {
      this.degree = y.degree;
      this.powers = y.powers;
      this.coefficients = y.coefficients;
    } else {
      checkArrayLength(x, y);
      regress(this, x, y, degree);
    }
  }

  _predict(x) {
    let y = 0;
    for (let k = 0; k < this.powers.length; k++) {
      y += this.coefficients[k] * Math.pow(x, this.powers[k]);
    }
    return y;
  }

  toJSON() {
    return {
      name: 'polynomialRegression',
      degree: this.degree,
      powers: this.powers,
      coefficients: this.coefficients,
    };
  }

  toString(precision) {
    return this._toFormula(precision, false);
  }

  toLaTeX(precision) {
    return this._toFormula(precision, true);
  }

  _toFormula(precision, isLaTeX) {
    let sup = '^';
    let closeSup = '';
    let times = ' * ';
    if (isLaTeX) {
      sup = '^{';
      closeSup = '}';
      times = '';
    }

    let fn = '';
    let str = '';
    for (let k = 0; k < this.coefficients.length; k++) {
      str = '';
      if (this.coefficients[k] !== 0) {
        if (this.powers[k] === 0) {
          str = maybeToPrecision(this.coefficients[k], precision);
        } else {
          if (this.powers[k] === 1) {
            str = `${maybeToPrecision(this.coefficients[k], precision) +
              times}x`;
          } else {
            str = `${maybeToPrecision(this.coefficients[k], precision) +
              times}x${sup}${this.powers[k]}${closeSup}`;
          }
        }

        if (this.coefficients[k] > 0 && k !== this.coefficients.length - 1) {
          str = ` + ${str}`;
        } else if (k !== this.coefficients.length - 1) {
          str = ` ${str}`;
        }
      }
      fn = str + fn;
    }
    if (fn.charAt(0) === '+') {
      fn = fn.slice(1);
    }

    return `f(x) = ${fn}`;
  }

  static load(json) {
    if (json.name !== 'polynomialRegression') {
      throw new TypeError('not a polynomial regression model');
    }
    return new PolynomialRegression(true, json);
  }
}

function regress(pr, x, y, degree) {
  const n = x.length;
  let powers;
  if (Array.isArray(degree)) {
    powers = degree;
    degree = powers.length;
  } else {
    degree++;
    powers = new Array(degree);
    for (let k = 0; k < degree; k++) {
      powers[k] = k;
    }
  }
  const F = new Matrix(n, degree);
  const Y = new Matrix([y]);
  for (let k = 0; k < degree; k++) {
    for (let i = 0; i < n; i++) {
      if (powers[k] === 0) {
        F.set(i, k, 1);
      } else {
        F.set(i, k, Math.pow(x[i], powers[k]));
      }
    }
  }

  const FT = new MatrixTransposeView(F);
  const A = FT.mmul(F);
  const B = FT.mmul(new MatrixTransposeView(Y));

  pr.degree = degree - 1;
  pr.powers = powers;
  pr.coefficients = solve(A, B).to1DArray();
}
