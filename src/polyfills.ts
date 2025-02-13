// Polyfill for Array.prototype.at and TypedArray.prototype.at.
// This is necessary for SuperNote devices with old WebView versions.
export function installAtPolyfill() {
    if (!Array.prototype.at) {
        const at = function(n: number) {
            // ToInteger() abstract op
            n = Math.trunc(n) || 0;
            // Allow negative indexing from the end
            if (n < 0) n += this.length;
            // OOB access is guaranteed to return undefined
            if (n < 0 || n >= this.length) return undefined;
            // Otherwise, this is just normal property access
            return this[n];
        };

        // Apply to Array and all TypedArray prototypes
        const typedArrays = [
            Int8Array, Uint8Array, Uint8ClampedArray,
            Int16Array, Uint16Array,
            Int32Array, Uint32Array,
            Float32Array, Float64Array,
            BigInt64Array, BigUint64Array
        ];

        Array.prototype.at = at;
        typedArrays.forEach(TypedArray => {
            if (TypedArray) {
                TypedArray.prototype.at = at;
            }
        });
    }
}
