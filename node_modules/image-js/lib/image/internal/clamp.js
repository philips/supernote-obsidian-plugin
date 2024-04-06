"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clamp = clamp;
function clamp(value, image) {
  return Math.round(Math.min(Math.max(value, 0), image.maxValue));
}