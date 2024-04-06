/**
 * Created by acastillo on 10/12/15.
 */

var FFTUtils = require("../src/FFTUtils");
var ns = [256,512,1024,2048];
var nks = [5,11,19,27,33,37];

var timesNormal = new Array(ns.length);
var timesFFT = new Array(ns.length);
for(var ni=0;ni<ns.length;ni++){

    timesNormal[ni]=new Array(nks.length);
    timesFFT[ni]=new Array(nks.length);

    for(var nki=0;nki<nks.length;nki++){
        var n=ns[ni];
        var data = new Uint32Array(n*n);
        for(var i=0;i<n;i++){
            for(var j=0;j<n;j++){
                data[i*n+j]=i+j;
            }
        }

        var kn = nks[nki];
        var kernel = new Array(kn);
        for(var i=0;i<kn;i++){
            kernel[i]=new Array(kn);
            for(var j=0;j<kn;j++){
                kernel[i][j]=i+j;
            }
        }

        var d = new Date();
        var start = d.getTime();
        var result1 = convolute(data, kernel, n, n);
        var d0 = new Date();
        timesNormal[ni][nki]=(d0.getTime()-start);
        var d2 = new Date();
        start = d2.getTime();
        var result2 = convoluteFFT(data, kernel, n, n);
        var d3 = new Date();
        timesFFT[ni][nki]=(d3.getTime()-start);
    }
}
console.log("Rows: Matrix size h/w "+ns.join(","));
console.log("Columns: Filter size h/w "+nks.join(","));
console.log("Normal");
console.log(timesNormal);
console.log("FFT");
console.log(timesFFT);

function convolute(data, kernel, height, width){
    var newImage = new Uint32Array(data.length);
    var kHeight = Math.floor(kernel.length/2);
    var kWidth = Math.floor(kernel[0].length/2);
    for (var y = kHeight; y < height - kHeight; y++) {
        for (var x = kWidth; x < width - kWidth; x++) {
            var sum = 0;
            for (var j = -kHeight; j <= kHeight; j++) {
                for (var i = -kWidth; i <= kWidth; i++) {
                    var kVal = kernel[kHeight + j][kWidth + i];
                    var index = ((y + j) * width + x + i);
                    sum += data[index] * kVal;
                }
            }

            var index = (y * width + x);
            newImage[index] = sum;
        }
    }

    return newImage;
}


function convoluteFFT(data, kernel, nRows, nCols){
    //console.log(nRows+ " " +nCols);
    var ftSpectrum = new Array(nCols * nRows);
    for (var i = 0; i<nRows * nCols; i++){
        ftSpectrum[i] = data[i];
    }

    ftSpectrum = FFTUtils.fft2DArray(ftSpectrum, nRows, nCols);

    var dim = kernel.length;
    var ftFilterData = new Array(nCols * nRows);
    for(var i=0;i<nCols * nRows;i++){
        ftFilterData[i]=0;
    }

    var iRow, iCol;
    var shift = (dim - 1) / 2;
    //console.log(dim);
    for (var ir = 0; ir < dim; ir++) {
        iRow = (ir - shift + nRows) % nRows;
        for (var ic = 0; ic < dim; ic++) {
            iCol = (ic - shift + nCols) % nCols;
            ftFilterData[iRow * nCols + iCol] = kernel[ir][ic];
        }
    }

    ftFilterData = FFTUtils.fft2DArray(ftFilterData, nRows, nCols);

    var ftRows = nRows * 2;
    var ftCols = nCols / 2 + 1;
    FFTUtils.convolute2DI(ftSpectrum, ftFilterData, ftRows, ftCols);

    return  FFTUtils.ifft2DArray(ftSpectrum, ftRows, ftCols);
}

