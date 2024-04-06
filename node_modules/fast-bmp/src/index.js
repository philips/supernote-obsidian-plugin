'use strict';

const Encoder = require('./BMPEncoder');

exports.encode = function encode(data) {
  const encoder = new Encoder(data);
  return encoder.encode();
};
