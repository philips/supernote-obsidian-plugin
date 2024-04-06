export default function directConvolution(input, kernel, output) {
    if (output === undefined) {
        const length = input.length + kernel.length - 1;
        output = new Array(length);
    }
    fill(output);
    for (var i = 0; i < input.length; i++) {
        for (var j = 0; j < kernel.length; j++) {
            output[i + j] += input[i] * kernel[j];
        }
    }
    return output;
}

function fill(array) {
    for (var i = 0; i < array.length; i++) {
        array[i] = 0;
    }
}
