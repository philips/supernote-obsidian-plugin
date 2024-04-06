'use strict';

var toString = Object.prototype.toString;

module.exports = function isArrayType(value) {
    return toString.call(value).substr(-6, 5) === 'Array';
};
