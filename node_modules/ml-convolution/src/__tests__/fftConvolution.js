import {fftConvolution} from '..';

describe('fft convolution', () => {

    it('fft with one value kernel', () => {
        expect(fftConvolution([0, 1, 2, 3], [0])).toEqual([0, 0, 0, 0]);
        expect(fftConvolution([0, 1, 2, 3], [1])).toEqual([0, 1, 2, 3]);
        expect(fftConvolution([0, 1, 2, 3], [2])).toEqual([0, 2, 4, 6]);
    });

    it('fft with three values kernel', () => {
        checkClose(fftConvolution([0, 1, 2, 3], [1, 1, 1]), [0, 1, 3, 6, 5, 3]);
        checkClose(fftConvolution([0, 1, 2, 3], [-1, 1, -1]), [0, -1, -1, -2, 1, -3]);
    });
});

function checkClose(result, expected) {
    for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeCloseTo(expected[i], Number.EPSILON);
    }
}
