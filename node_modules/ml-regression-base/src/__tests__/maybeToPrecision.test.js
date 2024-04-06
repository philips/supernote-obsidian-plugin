import maybeToPrecision from '../maybeToPrecision';

describe('maybeToPrecision', () => {
  it('positive number - no digit', () => {
    expect(maybeToPrecision(0)).toBe('0');
    expect(maybeToPrecision(10)).toBe('10');
    expect(maybeToPrecision(0.052469)).toBe('0.052469');
  });

  it('positive number - digit', () => {
    expect(maybeToPrecision(0, 1)).toBe('0');
    expect(maybeToPrecision(0, 2)).toBe('0.0');
    expect(maybeToPrecision(0.52469, 3)).toBe('0.525');
  });

  it('negative number - no digit', () => {
    expect(maybeToPrecision(-0)).toBe('0');
    expect(maybeToPrecision(-10)).toBe('- 10');
    expect(maybeToPrecision(-0.052469)).toBe('- 0.052469');
  });

  it('negative number - digit', () => {
    expect(maybeToPrecision(-0, 1)).toBe('0');
    expect(maybeToPrecision(-0, 2)).toBe('0.0');
    expect(maybeToPrecision(-0.52469, 3)).toBe('- 0.525');
    expect(maybeToPrecision(-4, 3)).toBe('- 4.00');
  });

  it('wrong digit option', () => {
    expect(() => {
      maybeToPrecision(0, 0);
    }).toThrow(/toPrecision\(\) argument must be between 1 and (?:100|21)/);
  });
});
