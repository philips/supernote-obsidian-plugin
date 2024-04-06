import TheilSenRegression from '..';

describe('Theil-Sen regression', () => {
  it('Simple case', () => {
    var inputs = [1, 2, 3, 4, 5];
    var outputs = [2, 3, 4, 5, 6];

    var regression = new TheilSenRegression(inputs, outputs);

    expect(regression.coefficients).toHaveLength(2);
    expect(regression.slope).toBe(regression.coefficients[1]);
    expect(regression.intercept).toBe(regression.coefficients[0]);

    expect(regression.slope).toBeCloseTo(1, 5);
    expect(regression.intercept).toBeCloseTo(1, 5);

    var y = regression.predict(85);
    expect(regression.computeX(y)).toBeCloseTo(85, 5);
    expect(y).toBeCloseTo(86, 5);

    expect(regression.toString(3)).toStrictEqual('f(x) = x + 1.00');
    expect(regression.toLaTeX(3)).toStrictEqual('f(x) = x + 1.00');
    expect(regression.toJSON().slope).toBe(1);
  });

  it('Outlier', () => {
    // outlier in the 4th value
    var inputs = [1, 2, 3, 4, 10, 12, 18];
    var outputs = [10, 14, 180, 22, 46, 54, 78];

    var regression = new TheilSenRegression(inputs, outputs);

    expect(regression.slope).toBeCloseTo(4, 3);
    expect(regression.intercept).toBeCloseTo(6, 3);
  });

  it('Constant', () => {
    var inputs = [0, 1, 2, 3];
    var outputs = [2, 2, 2, 2];

    var regression = new TheilSenRegression(inputs, outputs);

    expect(regression.toString()).toStrictEqual('f(x) = 2');
    expect(regression.toString(1)).toStrictEqual('f(x) = 2');
    expect(regression.toString(5)).toStrictEqual('f(x) = 2.0000');
  });

  it('Load and export model', () => {
    var regression = TheilSenRegression.load({
      name: 'TheilSenRegression',
      slope: -1,
      intercept: 0,
      quality: {
        r: 1,
        r2: 1,
        chi2: 145.8,
        rmsd: 0
      }
    });
    expect(regression.slope).toBe(-1);
    expect(regression.intercept).toBe(0);
    expect(regression.toString()).toStrictEqual('f(x) = - 1 * x');

    var model = regression.toJSON();
    expect(model.name).toStrictEqual('TheilSenRegression');
    expect(model.slope).toBe(-1);
    expect(model.intercept).toBe(0);

    expect(() => TheilSenRegression.load({ name: 1 })).toThrow(
      'not a Theil-Sen model'
    );
  });
});
