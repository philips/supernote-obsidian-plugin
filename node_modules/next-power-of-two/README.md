# next-power-of-two

[![frozen](http://badges.github.io/stability-badges/dist/frozen.svg)](http://github.com/badges/stability-badges)

For a positive number, returns the next highest power of two.

```js
var nextPOT = require('next-power-of-two')

nextPOT(100) === 128
nextPOT(50)  === 64
nextPOT(8)   === 8
```

## Usage

[![NPM](https://nodei.co/npm/next-power-of-two.png)](https://www.npmjs.com/package/next-power-of-two)

#### `nextPowerOfTwo(number)`

For the positive `number`, returns the next highest power of two value. If `number` is a power of two, it will be returned.

If `number` is zero, `1` is returned. Negative numbers produce undefined results.

## See Also

- [is-power-of-two](https://www.npmjs.com/package/is-power-of-two)

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/next-power-of-two/blob/master/LICENSE.md) for details.
