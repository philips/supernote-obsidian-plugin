import { NLR } from '..';

describe('Non-linear regression', function () {
  describe('Should give the correct parameters ', function () {
    it('Potential regression', function () {
      var x = [0.2, 0.4, 0.6, 0.8, 1.0];
      var y = [0.196, 0.785, 1.7665, 3.1405, 4.9075];
      var result = new NLR.PotentialRegression(x, y, 2, {
        computeQuality: true
      });
      expect(result.A).toBeCloseTo(4.9073, 10e-5);
      expect(result.M).toBe(2);
      const score = result.score(x, y);
      expect(score.r2).toBeGreaterThan(0.8);
      expect(score.chi2).toBeLessThan(0.1);
      expect(score.rmsd).toBeLessThan(0.01);
      expect(result.toString(4)).toBe('f(x) = 4.907 * x^2');
      expect(result.toLaTeX(4)).toBe('f(x) = 4.907x^{2}');
    });
  });

  describe('Load and export model ', function () {
    it('Potential regression', function () {
      var regression = NLR.PotentialRegression.load({
        name: 'potentialRegression',
        A: 1,
        M: -1
      });
      expect(regression.A).toBe(1);
      expect(regression.M).toBe(-1);
      expect(regression.toLaTeX()).toBe('f(x) = \\frac{1}{x^{1}}');

      var model = regression.toJSON();
      expect(model.name).toBe('potentialRegression');
      expect(model.A).toBe(1);
      expect(model.M).toBe(-1);
    });
  });
});
