# @swiftcarrot/color-fns

[![npm](https://img.shields.io/npm/v/@swiftcarrot/color-fns.svg)](https://www.npmjs.com/package/@swiftcarrot/color-fns)
[![npm](https://img.shields.io/npm/dm/@swiftcarrot/color-fns.svg)](https://www.npmjs.com/package/@swiftcarrot/color-fns)
[![Build Status](https://travis-ci.com/swiftcarrot/color-fns.svg?branch=master)](https://travis-ci.com/swiftcarrot/color-fns)
[![codecov](https://codecov.io/gh/swiftcarrot/color-fns/branch/master/graph/badge.svg)](https://codecov.io/gh/swiftcarrot/color-fns)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

Color functions for node and browser

### Installation

```sh
npm install @swiftcarrot/color-fns --save
yarn add @swiftcarrot/color-fns
```

### Usage

```javascript
// commonjs
const { hex2rgb } = require('@swiftcarrot/color-fns');

// es module
import { hex2rgb, cssColor } from '@swiftcarrot/color-fns';
import * as fns from '@swiftcarrot/color-fns';
```

### Available functions

- `cssColor`: parse a valid css [color value](https://developer.mozilla.org/en/docs/Web/CSS/color_value) to rgba format
- `hex2hsl`
- `hex2hsv`
- `hex2rgb`
- `hsl2hsv`
- `hsl2rgb`
- `hsv2hex`
- `hsv2hsl`
- `hsv2rgb`
- `rgb2hex`
- `rgb2hsv`
- `rgba`
- `rgba2hex`
- `rgba2rgb`

check [test](https://github.com/swiftcarrot/color-fns/blob/master/src/__tests__/index.js) for more examples

### License

MIT
