import BaseRegression from '..';

class NoPredict extends BaseRegression {}
class Basic extends BaseRegression {
  constructor(factor) {
    super();
    this.factor = factor;
  }
  _predict(x) {
    return x * this.factor;
  }
}

describe('base regression', () => {
  it('should not be directly constructable', () => {
    expect(() => {
      new BaseRegression();
    }).toThrow(/BaseRegression must be subclassed/);
  });

  it('should throw if _predict is not implemented', () => {
    const reg = new NoPredict();
    expect(() => {
      reg.predict(0);
    }).toThrow(/_predict must be implemented/);
  });

  it('should do a basic prediction', () => {
    const basic = new Basic(2);
    expect(basic.predict(1)).toBe(2);
    expect(basic.predict(2)).toBe(4);
    expect(basic.predict([2, 3])).toStrictEqual([4, 6]);
  });

  it('should throw on invalid value', () => {
    const basic = new Basic(2);
    expect(() => {
      basic.predict();
    }).toThrow(/must be a number or array/);
  });

  it('should implement dummy predictor functions', () => {
    const basic = new Basic(2);
    basic.train(); // should not throw
    expect(basic.toString()).toBe('');
    expect(basic.toLaTeX()).toBe('');
  });

  it('should implement a scoring function', () => {
    const basic = new Basic(2);
    expect(basic.score([1, 2], [2, 4])).toStrictEqual({
      r: 1,
      r2: 1,
      chi2: 0,
      rmsd: 0,
    });
    expect(basic.score([1, 2], [2, 4.1]).rmsd).toBe(0.0707106781186545);

    expect(basic.score([1, 2], [0.5, 2])).toStrictEqual({
      r: 1,
      r2: 1,
      chi2: 6.5,
      rmsd: 1.7677669529663689,
    });

    expect(basic.score([1, 2], [0, 1])).toStrictEqual({
      r: 1,
      r2: 1,
      chi2: 9,
      rmsd: 2.5495097567963922,
    });
  });

  it('should throw error if inputs are not arrays or has different length', () => {
    const basic = new Basic(2);
    expect(() => {
      basic.score(1, 2)
    }).toThrow("x and y must be arrays of the same length");

    expect(() => {
      basic.score([1, 2], [2])
    }).toThrow("x and y must be arrays of the same length");
  });
});
