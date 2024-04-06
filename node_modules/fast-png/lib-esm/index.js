import PngDecoder from './PngDecoder';
import PngEncoder from './PngEncoder';
export * from './types';
function decodePng(data, options) {
    const decoder = new PngDecoder(data, options);
    return decoder.decode();
}
function encodePng(png, options) {
    const encoder = new PngEncoder(png, options);
    return encoder.encode();
}
export { decodePng as decode, encodePng as encode };
//# sourceMappingURL=index.js.map