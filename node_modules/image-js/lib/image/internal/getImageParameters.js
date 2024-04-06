"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getImageParameters;
function getImageParameters(image) {
  return {
    width: image.width,
    height: image.height,
    components: image.components,
    alpha: image.alpha,
    colorModel: image.colorModel,
    bitDepth: image.bitDepth
  };
}