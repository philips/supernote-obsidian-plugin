import PowerRegression from '..';

describe('Power regression', () => {
  it('basic test', () => {
    const x = [17.6, 26, 31.9, 38.9, 45.8, 51.2, 58.1, 64.7, 66.7, 80.8, 82.9];
    const y = [
      159.9,
      206.9,
      236.8,
      269.9,
      300.6,
      323.6,
      351.7,
      377.6,
      384.1,
      437.2,
      444.7
    ];
    const result = new PowerRegression(x, y);

    const expected = {
      A: 24.12989312,
      B: 0.65949782
    };
    expect(result.A).toBeCloseTo(expected.A, 10e-4);
    expect(result.B).toBeCloseTo(expected.B, 10e-4);

    const x2 = [20, 30];
    const y2 = result.predict(x2);

    expect(y2[0]).toBeCloseTo(expected.A * Math.pow(x2[0], expected.B), 10e-4);
    expect(y2[1]).toBeCloseTo(expected.A * Math.pow(x2[1], expected.B), 10e-4);

    const score = result.score(x, y);
    expect(score.r2).toBeCloseTo(0.999, 1e-2);
    expect(score.chi2).toBeCloseTo(0.03, 1e-2);
    expect(score.rmsd).toBeCloseTo(0.03, 1e-2);
    expect(result.toString(4)).toStrictEqual('f(x) = 24.13 * x^0.6595');
    expect(result.toLaTeX(4)).toStrictEqual('f(x) = 24.13x^{0.6595}');
  });

  it('toJSON / load', () => {
    const regression = PowerRegression.load({
      name: 'powerRegression',
      A: 1,
      B: -1
    });

    expect(regression.predict(4)).toStrictEqual(0.25);

    const model = regression.toJSON();
    expect(model).toStrictEqual({
      name: 'powerRegression',
      A: 1,
      B: -1
    });
  });

  it('test latex formatting of big / small numbers', () => {
    const regression = PowerRegression.load({
      name: 'powerRegression',
      A: 1000000000,
      B: -0.000000001
    });

    expect(regression.toLaTeX(4)).toStrictEqual(
      'f(x) = \\frac{1.000e^{+9}}{x^{1.000e^{-9}}}'
    );
  });
});
