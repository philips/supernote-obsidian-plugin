"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterlaceMethod = exports.FilterMethod = exports.CompressionMethod = exports.ColorType = void 0;
var ColorType;
(function (ColorType) {
    ColorType[ColorType["UNKNOWN"] = -1] = "UNKNOWN";
    ColorType[ColorType["GREYSCALE"] = 0] = "GREYSCALE";
    ColorType[ColorType["TRUECOLOUR"] = 2] = "TRUECOLOUR";
    ColorType[ColorType["INDEXED_COLOUR"] = 3] = "INDEXED_COLOUR";
    ColorType[ColorType["GREYSCALE_ALPHA"] = 4] = "GREYSCALE_ALPHA";
    ColorType[ColorType["TRUECOLOUR_ALPHA"] = 6] = "TRUECOLOUR_ALPHA";
})(ColorType || (exports.ColorType = ColorType = {}));
var CompressionMethod;
(function (CompressionMethod) {
    CompressionMethod[CompressionMethod["UNKNOWN"] = -1] = "UNKNOWN";
    CompressionMethod[CompressionMethod["DEFLATE"] = 0] = "DEFLATE";
})(CompressionMethod || (exports.CompressionMethod = CompressionMethod = {}));
var FilterMethod;
(function (FilterMethod) {
    FilterMethod[FilterMethod["UNKNOWN"] = -1] = "UNKNOWN";
    FilterMethod[FilterMethod["ADAPTIVE"] = 0] = "ADAPTIVE";
})(FilterMethod || (exports.FilterMethod = FilterMethod = {}));
var InterlaceMethod;
(function (InterlaceMethod) {
    InterlaceMethod[InterlaceMethod["UNKNOWN"] = -1] = "UNKNOWN";
    InterlaceMethod[InterlaceMethod["NO_INTERLACE"] = 0] = "NO_INTERLACE";
    InterlaceMethod[InterlaceMethod["ADAM7"] = 1] = "ADAM7";
})(InterlaceMethod || (exports.InterlaceMethod = InterlaceMethod = {}));
//# sourceMappingURL=internalTypes.js.map