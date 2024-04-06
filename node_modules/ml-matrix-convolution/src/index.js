'use strict;'
/**
 * Created by acastillo on 7/7/16.
 */
var FFTUtils = require("ml-fft").FFTUtils;

function convolutionFFT(input, kernel, opt) {
    var tmp = matrix2Array(input);
    var inputData = tmp.data;
    var options = Object.assign({normalize : false, divisor : 1, rows:tmp.rows, cols:tmp.cols}, opt);

    var nRows, nCols;
    if (options.rows&&options.cols) {
        nRows = options.rows;
        nCols = options.cols;
    }
    else {
        throw new Error("Invalid number of rows or columns " + nRows + " " + nCols)
    }

    var divisor = options.divisor;
    var i,j;
    var kHeight =  kernel.length;
    var kWidth =  kernel[0].length;
    if (options.normalize) {
        divisor = 0;
        for (i = 0; i < kHeight; i++)
            for (j = 0; j < kWidth; j++)
                divisor += kernel[i][j];
    }
    if (divisor === 0) {
        throw new RangeError('convolution: The divisor is equal to zero');
    }

    var radix2Sized = FFTUtils.toRadix2(inputData, nRows, nCols);
    var conv = FFTUtils.convolute(radix2Sized.data, kernel, radix2Sized.rows, radix2Sized.cols);
    conv = FFTUtils.crop(conv, radix2Sized.rows, radix2Sized.cols, nRows, nCols);

    if(divisor!=0&&divisor!=1){
        for(i=0;i<conv.length;i++){
            conv[i]/=divisor;
        }
    }

    return conv;
}

function convolutionDirect(input, kernel, opt) {
    var tmp = matrix2Array(input);
    var inputData = tmp.data;
    var options = Object.assign({normalize : false, divisor : 1, rows:tmp.rows, cols:tmp.cols}, opt);

    var nRows, nCols;
    if (options.rows&&options.cols) {
        nRows = options.rows;
        nCols = options.cols;
    }
    else {
        throw new Error("Invalid number of rows or columns " + nRows + " " + nCols)
    }

    var divisor = options.divisor;
    var kHeight =  kernel.length;
    var kWidth =  kernel[0].length;
    var i, j, x, y, index, sum, kVal, row, col;
    if (options.normalize) {
        divisor = 0;
        for (i = 0; i < kHeight; i++)
            for (j = 0; j < kWidth; j++)
                divisor += kernel[i][j];
    }
    if (divisor === 0) {
        throw new RangeError('convolution: The divisor is equal to zero');
    }

    var output = new Array(nRows*nCols);

    var hHeight = Math.floor(kHeight/2);
    var hWidth = Math.floor(kWidth/2);

    for (y = 0; y < nRows; y++) {
        for (x = 0; x < nCols; x++) {
            sum = 0;
            for ( j = 0; j < kHeight; j++) {
                for ( i = 0; i < kWidth; i++) {
                    kVal = kernel[kHeight - j - 1][kWidth - i - 1];
                    row = (y + j -hHeight + nRows) % nRows;
                    col = (x + i - hWidth + nCols) % nCols;
                    index = (row * nCols + col);
                    sum += inputData[index] * kVal;
                }
            }
            index = (y * nCols + x);
            output[index]= sum / divisor;
        }
    }
    return output;
}



function LoG(sigma, nPoints, options){
    var factor = 1000;
    if(options&&options.factor){
        factor = options.factor;
    }

    var kernel = new Array(nPoints);
    var i,j,tmp,y2,tmp2;

    factor*=-1;//-1/(Math.PI*Math.pow(sigma,4));
    var center = (nPoints-1)/2;
    var sigma2 = 2*sigma*sigma;
    for( i=0;i<nPoints;i++){
        kernel[i]=new Array(nPoints);
        y2 = (i-center)*(i-center);
        for( j=0;j<nPoints;j++){
            tmp = -((j-center)*(j-center)+y2)/sigma2;
            kernel[i][j]=Math.round(factor*(1+tmp)*Math.exp(tmp));
        }
    }

    return kernel;
}

function matrix2Array(input){
    var inputData=input;
    var nRows, nCols;
    if(typeof input[0]!="number"){
        nRows = input.length;
        nCols = input[0].length;
        inputData = new Array(nRows*nCols);
        for(var i=0;i<nRows;i++){
            for(var j=0;j<nCols;j++){
                inputData[i*nCols+j]=input[i][j];
            }
        }
    }
    else{
        var tmp = Math.sqrt(input.length);
        if(Number.isInteger(tmp)){
            nRows=tmp;
            nCols=tmp;
        }
    }

    return {data:inputData,rows:nRows,cols:nCols};
}


module.exports = {
    fft:convolutionFFT,
    direct:convolutionDirect,
    kernelFactory:{LoG:LoG},
    matrix2Array:matrix2Array
};