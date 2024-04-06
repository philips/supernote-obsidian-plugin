# ml-fft

  [![NPM version][npm-image]][npm-url]
  [![build status][travis-image]][travis-url]
  [![David deps][david-image]][david-url]
  [![npm download][download-image]][download-url]

fft library for the ml libraries.

The idea of this, another flavor of the FFT library, is to perform, Real and Complex matrix FFT and IFFT, by using only the 1D FFT algorithm.
The 1D FFT and IFFT was taken and adapted from this project: [https://github.com/wellflat/javascript-labs/tree/master/cv/fft]

## Installation

`$ npm install ml-fft`

### Import in node

```js
var lib = require("ml-fft");
var FFT = lib.FFT;
var FFTUtils = lib.FFTUtils
```

### 1D FFT and IFFT

```js
var n = 16; 
var nCols = n; 
FFT.init(nCols);
var re = new Array(nCols);
var im = new Array(nCols);

for(var i=0;i<nCols;i++){
   re[i]=i;
   im[i]=nCols-i-1;
}

FFT.fft(re, im);
FFT.ifft(re, im);
```

### 2D FFT and 2D IFFT

data contains the matrix. The even rows contain the real part, the odd rows contain the imaginary part.


```js
var n = 4;
var nRows = n;
var nCols = n;
var data = new Array(nRows*nCols);
for(var i=0;i<nRows;i++){
    for(var j=0;j<nCols;j++){
        data[i*nCols+j]=i+j;
    }
}
var ftData = FFTUtils.fft2DArray(data, nCols, nCols);
var ftRows = nRows * 2;
var ftCols = nCols / 2 + 1;
var iftData =  FFTUtils.ifft2DArray(ftData, ftRows, ftCols);
```

### Matrix-Matrix convolution. 

It performs the convolution in the Fourier space(multiplication) and then makes an inverse transformation of the result. The difference in performance can be tested in the BenchMark script.

```js
var n=1024;
var data = new Uint32Array(n*n);
for(var i=0;i<n;i++){
    for(var j=0;j<n;j++){
        data[i*n+j]=i+j;
    }
}

var kn = 21;
var kernel = new Array(kn);
for(var i=0;i<kn;i++){
  kernel[i]=new Array(kn);
  for(var j=0;j<kn;j++){
      kernel[i][j]=i+j;
  }
}

var convolutedData = FFTUtils.convolute(data, kernel, n, n);
```
### toRadix2

Convert the data matrix to a radix2 2D matrix. The input data is a a single vector containing all the values of the matrix

```js
FFTUtils.toRadix2(data, nRows, nCols);
```

## License

  [MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/ml-fft.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ml-fft
[travis-image]: https://img.shields.io/travis/mljs/fft/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/mljs/fft
[david-image]: https://img.shields.io/david/mljs/fft.svg?style=flat-square
[david-url]: https://david-dm.org/mljs/fft
[download-image]: https://img.shields.io/npm/dm/ml-fft.svg?style=flat-square
[download-url]: https://npmjs.org/package/ml-fft
