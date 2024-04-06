import median from '..';

describe('array-median', () => {
  let data = [];
  for (let i = 0; i < 1000; i++) {
    data.push(Math.random());
  }

  it('should return the median', () => {
    expect(median([0])).toBe(0);
    expect(median([1])).toBe(1);
    expect(median([1, 2])).toBe(1);
    expect(median([1, 2, 1])).toBe(1);
    expect(median([3, 2, 1])).toBe(2);
    expect(median(data)).toBeCloseTo(0.5, 1);
  });
  it('should return the median with typed array', () => {
    let array = new Uint16Array(5);
    array[0] = 4;
    array[1] = 1;
    array[2] = 2;
    array[3] = 3;
    array[4] = 0;
    expect(median(array)).toBe(2);
  });

  it('should throw on invalid value', () => {
    expect(() => median([])).toThrow(/input must not be empty/);
    expect(() => median()).toThrow(/input must be an array/);
  });
});
