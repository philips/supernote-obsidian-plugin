import { isAnyArray } from 'is-any-array';

export default function checkArraySize(x, y) {
  if (!isAnyArray(x) || !isAnyArray(y)) {
    throw new TypeError('x and y must be arrays');
  }
  if (x.length !== y.length) {
    throw new RangeError('x and y arrays must have the same length');
  }
}
