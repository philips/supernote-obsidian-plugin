import SLR from '..';

describe('Simple Linear Regression', () => {
  it('SLR1', () => {
    const inputs = [80, 60, 10, 20, 30];
    const outputs = [20, 40, 30, 50, 60];

    const regression = new SLR(inputs, outputs);

    expect(regression.slope).toBe(regression.coefficients[1]);
    expect(regression.intercept).toBe(regression.coefficients[0]);

    expect(regression.slope).toBeCloseTo(-0.264706, 1e-5);
    expect(regression.intercept).toBeCloseTo(50.588235, 1e-5);

    const y = regression.predict(85);
    expect(regression.computeX(y)).toBe(85);
    expect(y).toBeCloseTo(28.088235294117649, 1e-10);

    expect(regression.toString(3)).toBe('f(x) = - 0.265 * x + 50.6');
  });

  it('SLR2', () => {
    // example from https://en.wikipedia.org/wiki/Simple_linear_regression#Numerical_example
    const inputs = [
      1.47,
      1.5,
      1.52,
      1.55,
      1.57,
      1.6,
      1.63,
      1.65,
      1.68,
      1.7,
      1.73,
      1.75,
      1.78,
      1.8,
      1.83,
    ];
    const outputs = [
      52.21,
      53.12,
      54.48,
      55.84,
      57.2,
      58.57,
      59.93,
      61.29,
      63.11,
      64.47,
      66.28,
      68.1,
      69.92,
      72.19,
      74.46,
    ];

    const regression = new SLR(inputs, outputs);

    expect(regression.slope).toBeCloseTo(61.272, 1e-3);
    expect(regression.intercept).toBeCloseTo(-39.062, 1e-3);

    const score = regression.score(inputs, outputs);
    expect(score.r).toBeCloseTo(0.9945, 1e-4);
    expect(score.r2).toBe(score.r * score.r);
    expect(score.chi2).toBeLessThan(1);
    expect(score.rmsd).toBeLessThan(1);
  });

  it('SLR3', () => {
    const inputs = [0, 1, 2, 3, 4, 5];
    const outputs = [10, 8, 6, 4, 2, 0];

    const regression = new SLR(inputs, outputs);

    expect(regression.slope).toBe(-2);
    expect(regression.intercept).toBe(10);
    expect(regression.predict(6)).toBe(-2);
    expect(regression.predict(-1)).toBe(12);
    expect(regression.predict(2.5)).toBe(5);
    expect(regression.computeX(5)).toBe(2.5);
    expect(regression.computeX(9)).toBe(0.5);
    expect(regression.computeX(-12)).toBe(11);

    const score = regression.score(inputs, outputs);
    expect(score.r).toBeGreaterThan(0);
    expect(score.r2).toBe(1);
    expect(score.chi2).toBe(0);
    expect(score.rmsd).toBe(0);

    expect(regression.toString(3)).toBe('f(x) = - 2.00 * x + 10.0');
  });

  it('SLR constant', () => {
    const inputs = [0, 1, 2, 3];
    const outputs = [2, 2, 2, 2];

    const regression = new SLR(inputs, outputs);
    expect(regression.toLaTeX()).toBe('f(x) = 2');
    expect(regression.toString()).toBe('f(x) = 2');
    expect(regression.toString(1)).toBe('f(x) = 2');
    expect(regression.toString(5)).toBe('f(x) = 2.0000');
  });

  it('negative intercept and slope', () => {
    const inputs = [-1, 0, 1];
    const outputs = [-2, -1, 0];

    const regression = new SLR(inputs, outputs);

    expect(regression.toString()).toBe('f(x) = x - 1');
  });

  it('intercept = 0', () => {
    const regression = new SLR([0, 1, 2], [0, 1, 2]);
    expect(regression.slope).toBe(1);
    expect(regression.intercept).toBe(0);
    expect(regression.toString()).toBe('f(x) = x');
  });

  it('different size on input and output', () => {
    const inputs = [0, 1, 2];
    const outputs = [0, 1];
    expect(() => new SLR(inputs, outputs)).toThrow(
      /x and y arrays must have the same length/,
    );
  });

  it('Load and export model', () => {
    const regression = SLR.load({
      name: 'simpleLinearRegression',
      slope: 1,
      intercept: 1,
    });
    expect(regression.slope).toBe(1);
    expect(regression.intercept).toBe(1);
    expect(regression.coefficients).toStrictEqual([1, 1]);

    const model = regression.toJSON();
    expect(model.name).toBe('simpleLinearRegression');
    expect(model.slope).toBe(1);
    expect(model.intercept).toBe(1);
  });

  it('wrong model', () => {
    expect(() => SLR.load({})).toThrow(/^not a SLR model$/);
  });
});
