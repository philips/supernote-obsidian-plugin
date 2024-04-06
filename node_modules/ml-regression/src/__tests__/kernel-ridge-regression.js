import { Matrix } from 'ml-matrix';

import { KernelRidgeRegression } from '..';

var nSamples = 10;
var nVars = 2;

var Xs = Matrix.random(nSamples, nVars);
Xs.sub(0.5);
var Ys = Matrix.zeros(nSamples, 1);
for (var i = 0; i < nSamples; i++) {
  Ys.set(
    i,
    0,
    Xs.get(i, 0) * Xs.get(i, 0) +
      2 * Xs.get(i, 0) * Xs.get(i, 1) +
      Xs.get(i, 1) * Xs.get(i, 1)
  );
}

describe('Kernel ridge regression', function () {
  it('constant outputs', function () {
    var model = new KernelRidgeRegression([[0, 0], [1, 1]], [[0], [0]]);
    expect(model.predict([[1, 1], [2, 5], [4, 7]])).toStrictEqual([
      [0],
      [0],
      [0]
    ]);
  });
  it('Polynomial kernel should overfit the pattern', function () {
    var model = new KernelRidgeRegression(Xs, Ys, {
      kernelType: 'polynomial',
      lambda: 0.0001,
      kernelOptions: { degree: 2, constant: 1 }
    });
    var Y = model.predict(Xs.to2DArray());

    for (i = 0; i < Y.length; i++) {
      expect(Y[i][0]).toBeCloseTo(Ys.get(i, 0), 5e-3);
    }
  });
  it('Gaussian kernel should overfit the pattern', function () {
    var model = new KernelRidgeRegression(Xs, Ys, {
      kernelType: 'gaussian',
      lambda: 0.0001,
      kernelOptions: { sigma: 0.1 },
      computeQuality: true
    });
    var Y = model.predict(Xs.to2DArray());
    for (var i = 0; i < Y.length; i++) {
      expect(Y[i][0]).toBeCloseTo(Ys.get(i, 0), 5e-3);
    }
  });
  it('Load and export model', function () {
    var regression = new KernelRidgeRegression(true, {
      name: 'kernelRidgeRegression',
      alpha: 1,
      inputs: 1,
      kernelType: 'gaussian',
      kernelOptions: {}
    });
    expect(regression.alpha).toBe(1);
    expect(regression.kernelType).toBe('gaussian');

    var model = regression.toJSON();
    expect(model.name).toBe('kernelRidgeRegression');
    expect(model.alpha).toBe(1);
    expect(model.kernelType).toBe('gaussian');
  });
});
