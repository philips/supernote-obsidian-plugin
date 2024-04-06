import { PolinomialFitting2D as Polyfit } from '..';

describe('2D polinomial fit', () => {
  const X = new Array(21);
  const y = new Array(21);
  for (let i = 0; i < 21; ++i) {
    X[i] = [i, i + 10];
    y[i] = i + 20;
  }

  const pf = new Polyfit(X, y, {
    order: 2
  });

  it('Training coefficients', () => {
    const estimatedCoefficients = [
      1.5587e1,
      3.8873e-1,
      5.2582e-3,
      4.8498e-1,
      2.1127e-3,
      -7.3709e-3
    ];
    for (let i = 0; i < estimatedCoefficients.length; ++i) {
      expect(pf.coefficients.get(i, 0)).toBeCloseTo(estimatedCoefficients[i], 1e-2);
    }
  });

  it('Prediction', () => {
    var test = new Array(11);
    var val = 0.5;
    for (var i = 0; i < 11; ++i) {
      test[i] = [val, val + 10];
      val++;
    }

    var y = pf.predict(test);

    var j = 0;
    for (i = 20.5; i < 30.5; i++, j++) {
      expect(y[j]).toBeCloseTo(i, 1e-2);
    }
  });

  it('Other function test', () => {
    var testValues = [
      15.041667,
      9.375,
      5.041667,
      2.041667,
      0.375,
      0.041667,
      1.041667,
      3.375,
      7.041667,
      12.041667
    ];

    var len = 21;

    var X = new Array(len);
    var val = 5.0;
    var y = new Array(len);
    for (var i = 0; i < len; ++i, val += 0.5) {
      X[i] = [val, val];
      y[i] = val * val + val * val;
    }

    var polyFit = new Polyfit(X, y, {
      order: 2
    });

    var test = 10;
    var x1 = -4.75;
    var x2 = 4.75;
    var X1 = new Array(test);
    for (i = 0; i < test; ++i) {
      X1[i] = [x1, x2];
      x1++;
      x2--;
    }

    var predict = polyFit.predict(X1);
    for (i = 0; i < testValues.length; ++i) {
      expect(predict[i]).toBeCloseTo(testValues[i], 1e-2);
    }
  });
});
