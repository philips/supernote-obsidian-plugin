import * as regression from '..';

describe('test that re-exports are OK', () => {
  it('should export functions', () => {
    expect(regression.SimpleLinearRegression).toBeInstanceOf(Function);
    expect(regression.PolynomialRegression).toBeInstanceOf(Function);
    expect(regression.ExponentialRegression).toBeInstanceOf(Function);
    expect(regression.PowerRegression).toBeInstanceOf(Function);
    expect(regression.MultivariateLinearRegression).toBeInstanceOf(Function);
    expect(regression.TheilSenRegression).toBeInstanceOf(Function);
    expect(regression.RobustPolynomialRegression).toBeInstanceOf(Function);
  });
});
