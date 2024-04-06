import PolynomialRegression from '..';

describe('Polynomial regression', () => {
  it('degree 2', () => {
    const x = [-3, 0, 2, 4];
    const y = [3, 1, 1, 3];
    const result = new PolynomialRegression(x, y, 2);

    const expected = [0.850519, -0.192495, 0.178462];

    for (let i = 0; i < expected.length; ++i) {
      expect(result.coefficients[i]).toBeCloseTo(expected[i], 10e-6);
      expect(result.powers[i]).toBe(i);
    }

    const score = result.score(x, y);
    expect(score.r2).toBeGreaterThan(0.8);
    expect(score.chi2).toBeLessThan(0.1);
    expect(score.rmsd).toBeCloseTo(0.12);
    expect(result.toString(4)).toBe(
      'f(x) = 0.1785 * x^2 - 0.1925 * x + 0.8505',
    );
    expect(result.toLaTeX(2)).toBe('f(x) = 0.18x^{2} - 0.19x + 0.85');
  });

  it('degree 2 typed array', () => {
    const x = new Float64Array([-3, 0, 2, 4]);
    const y = new Float64Array([3, 1, 1, 3]);
    const result = new PolynomialRegression(x, y, 2);

    const expected = [0.850519, -0.192495, 0.178462];

    for (let i = 0; i < expected.length; ++i) {
      expect(result.coefficients[i]).toBeCloseTo(expected[i], 10e-6);
      expect(result.powers[i]).toBe(i);
    }

    const score = result.score(x, y);
    expect(score.r2).toBeGreaterThan(0.8);
    expect(score.chi2).toBeLessThan(0.1);
    expect(score.rmsd).toBeCloseTo(0.12);
    expect(result.toString(4)).toBe(
      'f(x) = 0.1785 * x^2 - 0.1925 * x + 0.8505',
    );
    expect(result.toLaTeX(2)).toBe('f(x) = 0.18x^{2} - 0.19x + 0.85');
  });

  it('degree 5', () => {
    const x = [50, 50, 50, 70, 70, 70, 80, 80, 80, 90, 90, 90, 100, 100, 100];
    const y = [
      3.3,
      2.8,
      2.9,
      2.3,
      2.6,
      2.1,
      2.5,
      2.9,
      2.4,
      3.0,
      3.1,
      2.8,
      3.3,
      3.5,
      3.0,
    ];
    const degree = 5;
    const regression = new PolynomialRegression(x, y, degree);
    expect(regression.predict(80)).toBeCloseTo(2.6, 1e-6);
    expect(regression.coefficients).toStrictEqual([
      17.39552328011271,
      -0.3916378430736305,
      -0.0019874818431079486,
      0.0001367602062643227,
      -0.000001302280135149651,
      3.837755337564968e-9,
    ]);
    expect(regression.toString(3)).toBe(
      'f(x) = 3.84e-9 * x^5 - 0.00000130 * x^4 + 0.000137 * x^3 - 0.00199 * x^2 - 0.392 * x + 17.4',
    );
  });

  it('toJSON and load', () => {
    const regression = PolynomialRegression.load({
      name: 'polynomialRegression',
      degree: 1,
      powers: [1],
      coefficients: [-1],
    });

    expect(regression.predict(1)).toBe(-1);

    const model = regression.toJSON();
    expect(model).toStrictEqual({
      name: 'polynomialRegression',
      degree: 1,
      powers: [1],
      coefficients: [-1],
    });
  });
});
