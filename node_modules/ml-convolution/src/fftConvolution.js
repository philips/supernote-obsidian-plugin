import FFT from 'fft.js';
import nextPOT from 'next-power-of-two';

export default function fftConvolution(input, kernel) {
    const resultLength = input.length + kernel.length - 1;
    const fftLength = nextPOT(resultLength);

    const fft = new FFT(fftLength);

    const {output: fftKernel, input: result} = createPaddedFFt(kernel, fft, fftLength);
    const {output: fftInput} = createPaddedFFt(input, fft, fftLength);

    // reuse arrays
    const fftConv = fftInput;
    const conv = fftKernel;
    for (var i = 0; i < fftConv.length; i += 2) {
        const tmp = fftInput[i] * fftKernel[i] - fftInput[i + 1] * fftKernel[i + 1];
        fftConv[i + 1] = fftInput[i] * fftKernel[i + 1] + fftInput[i + 1] * fftKernel[i];
        fftConv[i] = tmp;
    }
    fft.inverseTransform(conv, fftConv);
    return fft.fromComplexArray(conv, result).slice(0, resultLength);
}

function createPaddedFFt(data, fft, length) {
    const input = new Array(length);
    var i = 0;
    for (; i < data.length; i++) {
        input[i] = data[i];
    }
    for (;i < length; i++) {
        input[i] = 0;
    }
    const fftInput = fft.toComplexArray(input);
    const output = fft.createComplexArray();
    fft.transform(output, fftInput);
    return {
        output,
        input,
        fftInput
    };
}
