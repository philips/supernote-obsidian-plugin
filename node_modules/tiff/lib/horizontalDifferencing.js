"use strict";
// Section 14: Differencing Predictor (p. 64)
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyHorizontalDifferencing16Bit = exports.applyHorizontalDifferencing8Bit = void 0;
function applyHorizontalDifferencing8Bit(data, width, components) {
    let i = 0;
    while (i < data.length) {
        for (let j = components; j < width * components; j += components) {
            for (let k = 0; k < components; k++) {
                data[i + j + k] =
                    (data[i + j + k] + data[i + j - (components - k)]) & 255;
            }
        }
        i += width * components;
    }
}
exports.applyHorizontalDifferencing8Bit = applyHorizontalDifferencing8Bit;
function applyHorizontalDifferencing16Bit(data, width, components) {
    let i = 0;
    while (i < data.length) {
        for (let j = components; j < width * components; j += components) {
            for (let k = 0; k < components; k++) {
                data[i + j + k] =
                    (data[i + j + k] + data[i + j - (components - k)]) & 65535;
            }
        }
        i += width * components;
    }
}
exports.applyHorizontalDifferencing16Bit = applyHorizontalDifferencing16Bit;
//# sourceMappingURL=horizontalDifferencing.js.map