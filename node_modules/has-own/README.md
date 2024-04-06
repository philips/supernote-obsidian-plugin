#has-own

[![Build Status](https://travis-ci.org/pebble/has-own.svg?branch=master)](https://travis-ci.org/pebble/has-own)

Shorthand `Object.prototype.hasOwnProperty.call(obj, name)`.

```js
var assert = require('assert');
var hasOwn = require('has-own');

var o = Object.create(null);
o.name = 'has-own';

assert(hasOwn('name', o)); // true
```

Why another module? Because I like its readability.

[LICENSE](https://github.com/pebble/has-own/blob/master/LICENSE)
