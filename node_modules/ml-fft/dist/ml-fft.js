(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["mlFft"] = factory();
	else
		root["mlFft"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	exports.FFTUtils = __webpack_require__(1);
	exports.FFT = __webpack_require__(2);


/***/ },
/* 1 */
/***/ function(module, exports, __webpack_require__) {

	'use strict'

	var FFT = __webpack_require__(2);

	var FFTUtils= {
	    DEBUG : false,

	    /**
	     * Calculates the inverse of a 2D Fourier transform
	     *
	     * @param ft
	     * @param ftRows
	     * @param ftCols
	     * @return
	     */
	    ifft2DArray : function(ft, ftRows, ftCols){
	        var tempTransform = new Array(ftRows * ftCols);
	        var nRows = ftRows / 2;
	        var nCols = (ftCols - 1) * 2;
	        // reverse transform columns
	        FFT.init(nRows);
	        var tmpCols = {re: new Array(nRows), im: new Array(nRows)};
	        for (var iCol = 0; iCol < ftCols; iCol++) {
	            for (var iRow = nRows - 1; iRow >= 0; iRow--) {
	                tmpCols.re[iRow] = ft[(iRow * 2) * ftCols + iCol];
	                tmpCols.im[iRow] = ft[(iRow * 2 + 1) * ftCols + iCol];
	            }
	            //Unnormalized inverse transform
	            FFT.bt(tmpCols.re, tmpCols.im);
	            for (var iRow = nRows - 1; iRow >= 0; iRow--) {
	                tempTransform[(iRow * 2) * ftCols + iCol] = tmpCols.re[iRow];
	                tempTransform[(iRow * 2 + 1) * ftCols + iCol] = tmpCols.im[iRow];
	            }
	        }

	        // reverse row transform
	        var finalTransform = new Array(nRows * nCols);
	        FFT.init(nCols);
	        var tmpRows = {re: new Array(nCols), im: new Array(nCols)};
	        var scale = nCols * nRows;
	        for (var iRow = 0; iRow < ftRows; iRow += 2) {
	            tmpRows.re[0] = tempTransform[iRow * ftCols];
	            tmpRows.im[0] = tempTransform[(iRow + 1) * ftCols];
	            for (var iCol = 1; iCol < ftCols; iCol++) {
	                tmpRows.re[iCol] = tempTransform[iRow * ftCols + iCol];
	                tmpRows.im[iCol] = tempTransform[(iRow + 1) * ftCols + iCol];
	                tmpRows.re[nCols - iCol] = tempTransform[iRow * ftCols + iCol];
	                tmpRows.im[nCols - iCol] = -tempTransform[(iRow + 1) * ftCols + iCol];
	            }
	            //Unnormalized inverse transform
	            FFT.bt(tmpRows.re, tmpRows.im);

	            var indexB = (iRow / 2) * nCols;
	            for (var iCol = nCols - 1; iCol >= 0; iCol--) {
	                finalTransform[indexB + iCol] = tmpRows.re[iCol] / scale;
	            }
	        }
	        return finalTransform;
	    },
	    /**
	     * Calculates the fourier transform of a matrix of size (nRows,nCols) It is
	     * assumed that both nRows and nCols are a power of two
	     *
	     * On exit the matrix has dimensions (nRows * 2, nCols / 2 + 1) where the
	     * even rows contain the real part and the odd rows the imaginary part of the
	     * transform
	     * @param data
	     * @param nRows
	     * @param nCols
	     * @return
	     */
	    fft2DArray:function(data, nRows, nCols, opt) {
	        var options = Object.assign({},{inplace:true})
	        var ftCols = (nCols / 2 + 1);
	        var ftRows = nRows * 2;
	        var tempTransform = new Array(ftRows * ftCols);
	        FFT.init(nCols);
	        // transform rows
	        var tmpRows = {re: new Array(nCols), im: new Array(nCols)};
	        var row1 = {re: new Array(nCols), im: new Array(nCols)}
	        var row2 = {re: new Array(nCols), im: new Array(nCols)}
	        var index, iRow0, iRow1, iRow2, iRow3;
	        for (var iRow = 0; iRow < nRows / 2; iRow++) {
	            index = (iRow * 2) * nCols;
	            tmpRows.re = data.slice(index, index + nCols);

	            index = (iRow * 2 + 1) * nCols;
	            tmpRows.im = data.slice(index, index + nCols);

	            FFT.fft1d(tmpRows.re, tmpRows.im);

	            this.reconstructTwoRealFFT(tmpRows, row1, row2);
	            //Now lets put back the result into the output array
	            iRow0 = (iRow * 4) * ftCols;
	            iRow1 = (iRow * 4 + 1) * ftCols;
	            iRow2 = (iRow * 4 + 2) * ftCols;
	            iRow3 = (iRow * 4 + 3) * ftCols;
	            for (var k = ftCols - 1; k >= 0; k--) {
	                tempTransform[iRow0 + k] = row1.re[k];
	                tempTransform[iRow1 + k] = row1.im[k];
	                tempTransform[iRow2 + k] = row2.re[k];
	                tempTransform[iRow3 + k] = row2.im[k];
	            }
	        }

	        //console.log(tempTransform);
	        row1 = null;
	        row2 = null;
	        // transform columns
	        var finalTransform = new Array(ftRows * ftCols);

	        FFT.init(nRows);
	        var tmpCols = {re: new Array(nRows), im: new Array(nRows)};
	        for (var iCol = ftCols - 1; iCol >= 0; iCol--) {
	            for (var iRow = nRows - 1; iRow >= 0; iRow--) {
	                tmpCols.re[iRow] = tempTransform[(iRow * 2) * ftCols + iCol];
	                tmpCols.im[iRow] = tempTransform[(iRow * 2 + 1) * ftCols + iCol];
	                //TODO Chech why this happens
	                if(isNaN(tmpCols.re[iRow])){
	                    tmpCols.re[iRow]=0;
	                }
	                if(isNaN(tmpCols.im[iRow])){
	                    tmpCols.im[iRow]=0;
	                }
	            }
	            FFT.fft1d(tmpCols.re, tmpCols.im);
	            for (var iRow = nRows - 1; iRow >= 0; iRow--) {
	                finalTransform[(iRow * 2) * ftCols + iCol] = tmpCols.re[iRow];
	                finalTransform[(iRow * 2 + 1) * ftCols + iCol] = tmpCols.im[iRow];
	            }
	        }

	        //console.log(finalTransform);
	        return finalTransform;

	    },
	    /**
	     *
	     * @param fourierTransform
	     * @param realTransform1
	     * @param realTransform2
	     *
	     * Reconstructs the individual Fourier transforms of two simultaneously
	     * transformed series. Based on the Symmetry relationships (the asterisk
	     * denotes the complex conjugate)
	     *
	     * F_{N-n} = F_n^{*} for a purely real f transformed to F
	     *
	     * G_{N-n} = G_n^{*} for a purely imaginary g transformed to G
	     *
	     */
	    reconstructTwoRealFFT:function(fourierTransform, realTransform1, realTransform2) {
	        var length = fourierTransform.re.length;

	        // the components n=0 are trivial
	        realTransform1.re[0] = fourierTransform.re[0];
	        realTransform1.im[0] = 0.0;
	        realTransform2.re[0] = fourierTransform.im[0];
	        realTransform2.im[0] = 0.0;
	        var rm, rp, im, ip, j;
	        for (var i = length / 2; i > 0; i--) {
	            j = length - i;
	            rm = 0.5 * (fourierTransform.re[i] - fourierTransform.re[j]);
	            rp = 0.5 * (fourierTransform.re[i] + fourierTransform.re[j]);
	            im = 0.5 * (fourierTransform.im[i] - fourierTransform.im[j]);
	            ip = 0.5 * (fourierTransform.im[i] + fourierTransform.im[j]);
	            realTransform1.re[i] = rp;
	            realTransform1.im[i] = im;
	            realTransform1.re[j] = rp;
	            realTransform1.im[j] = -im;
	            realTransform2.re[i] = ip;
	            realTransform2.im[i] = -rm;
	            realTransform2.re[j] = ip;
	            realTransform2.im[j] = rm;
	        }
	    },

	    /**
	     * In place version of convolute 2D
	     *
	     * @param ftSignal
	     * @param ftFilter
	     * @param ftRows
	     * @param ftCols
	     * @return
	     */
	    convolute2DI:function(ftSignal, ftFilter, ftRows, ftCols) {
	        var re, im;
	        for (var iRow = 0; iRow < ftRows / 2; iRow++) {
	            for (var iCol = 0; iCol < ftCols; iCol++) {
	                //
	                re = ftSignal[(iRow * 2) * ftCols + iCol]
	                    * ftFilter[(iRow * 2) * ftCols + iCol]
	                    - ftSignal[(iRow * 2 + 1) * ftCols + iCol]
	                    * ftFilter[(iRow * 2 + 1) * ftCols + iCol];
	                im = ftSignal[(iRow * 2) * ftCols + iCol]
	                    * ftFilter[(iRow * 2 + 1) * ftCols + iCol]
	                    + ftSignal[(iRow * 2 + 1) * ftCols + iCol]
	                    * ftFilter[(iRow * 2) * ftCols + iCol];
	                //
	                ftSignal[(iRow * 2) * ftCols + iCol] = re;
	                ftSignal[(iRow * 2 + 1) * ftCols + iCol] = im;
	            }
	        }
	    },
	    /**
	     *
	     * @param data
	     * @param kernel
	     * @param nRows
	     * @param nCols
	     * @returns {*}
	     */
	    convolute:function(data, kernel, nRows, nCols, opt) {
	        var ftSpectrum = new Array(nCols * nRows);
	        for (var i = 0; i<nRows * nCols; i++) {
	            ftSpectrum[i] = data[i];
	        }

	        ftSpectrum = this.fft2DArray(ftSpectrum, nRows, nCols);


	        var dimR = kernel.length;
	        var dimC = kernel[0].length;
	        var ftFilterData = new Array(nCols * nRows);
	        for(var i = 0; i < nCols * nRows; i++) {
	            ftFilterData[i] = 0;
	        }

	        var iRow, iCol;
	        var shiftR = Math.floor((dimR - 1) / 2);
	        var shiftC = Math.floor((dimC - 1) / 2);
	        for (var ir = 0; ir < dimR; ir++) {
	            iRow = (ir - shiftR + nRows) % nRows;
	            for (var ic = 0; ic < dimC; ic++) {
	                iCol = (ic - shiftC + nCols) % nCols;
	                ftFilterData[iRow * nCols + iCol] = kernel[ir][ic];
	            }
	        }
	        ftFilterData = this.fft2DArray(ftFilterData, nRows, nCols);

	        var ftRows = nRows * 2;
	        var ftCols = nCols / 2 + 1;
	        this.convolute2DI(ftSpectrum, ftFilterData, ftRows, ftCols);

	        return this.ifft2DArray(ftSpectrum, ftRows, ftCols);
	    },


	    toRadix2:function(data, nRows, nCols) {
	        var i, j, irow, icol;
	        var cols = nCols, rows = nRows, prows=0, pcols=0;
	        if(!(nCols !== 0 && (nCols & (nCols - 1)) === 0)) {
	            //Then we have to make a pading to next radix2
	            cols = 0;
	            while((nCols>>++cols)!=0);
	            cols=1<<cols;
	            pcols = cols-nCols;
	        }
	        if(!(nRows !== 0 && (nRows & (nRows - 1)) === 0)) {
	            //Then we have to make a pading to next radix2
	            rows = 0;
	            while((nRows>>++rows)!=0);
	            rows=1<<rows;
	            prows = (rows-nRows)*cols;
	        }
	        if(rows==nRows&&cols==nCols)//Do nothing. Returns the same input!!! Be careful
	            return {data:data, rows:nRows, cols:nCols};

	        var output = new Array(rows*cols);
	        var shiftR = Math.floor((rows-nRows)/2)-nRows;
	        var shiftC = Math.floor((cols-nCols)/2)-nCols;

	        for( i = 0; i < rows; i++) {
	            irow = i*cols;
	            icol = ((i-shiftR) % nRows) * nCols;
	            for( j = 0; j < cols; j++) {
	                output[irow+j] = data[(icol+(j-shiftC) % nCols) ];
	            }
	        }
	        return {data:output, rows:rows, cols:cols};
	    },

	    /**
	     * Crop the given matrix to fit the corresponding number of rows and columns
	     */
	    crop:function(data, rows, cols, nRows, nCols, opt) {

	        if(rows == nRows && cols == nCols)//Do nothing. Returns the same input!!! Be careful
	            return data;

	        var options = Object.assign({}, opt);

	        var output = new Array(nCols*nRows);

	        var shiftR = Math.floor((rows-nRows)/2);
	        var shiftC = Math.floor((cols-nCols)/2);
	        var destinyRow, sourceRow, i, j;
	        for( i = 0; i < nRows; i++) {
	            destinyRow = i*nCols;
	            sourceRow = (i+shiftR)*cols;
	            for( j = 0;j < nCols; j++) {
	                output[destinyRow+j] = data[sourceRow+(j+shiftC)];
	            }
	        }

	        return output;
	    }
	}

	module.exports = FFTUtils;


/***/ },
/* 2 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Fast Fourier Transform module
	 * 1D-FFT/IFFT, 2D-FFT/IFFT (radix-2)
	 */
	var FFT = (function(){
	  var FFT;  
	  
	  if(true) {
	    FFT = exports;   // for CommonJS
	  } else {
	    FFT = {};
	  }
	  
	  var version = {
	    release: '0.3.0',
	    date: '2013-03'
	  };
	  FFT.toString = function() {
	    return "version " + version.release + ", released " + version.date;
	  };

	  // core operations
	  var _n = 0,          // order
	      _bitrev = null,  // bit reversal table
	      _cstb = null;    // sin/cos table

	  var core = {
	    init : function(n) {
	      if(n !== 0 && (n & (n - 1)) === 0) {
	        _n = n;
	        core._initArray();
	        core._makeBitReversalTable();
	        core._makeCosSinTable();
	      } else {
	        throw new Error("init: radix-2 required");
	      }
	    },
	    // 1D-FFT
	    fft1d : function(re, im) {
	      core.fft(re, im, 1);
	    },
	    // 1D-IFFT
	    ifft1d : function(re, im) {
	      var n = 1/_n;
	      core.fft(re, im, -1);
	      for(var i=0; i<_n; i++) {
	        re[i] *= n;
	        im[i] *= n;
	      }
	    },
	     // 1D-IFFT
	    bt1d : function(re, im) {
	      core.fft(re, im, -1);
	    },
	    // 2D-FFT Not very useful if the number of rows have to be equal to cols
	    fft2d : function(re, im) {
	      var tre = [],
	          tim = [],
	          i = 0;
	      // x-axis
	      for(var y=0; y<_n; y++) {
	        i = y*_n;
	        for(var x1=0; x1<_n; x1++) {
	          tre[x1] = re[x1 + i];
	          tim[x1] = im[x1 + i];
	        }
	        core.fft1d(tre, tim);
	        for(var x2=0; x2<_n; x2++) {
	          re[x2 + i] = tre[x2];
	          im[x2 + i] = tim[x2];
	        }
	      }
	      // y-axis
	      for(var x=0; x<_n; x++) {
	        for(var y1=0; y1<_n; y1++) {
	          i = x + y1*_n;
	          tre[y1] = re[i];
	          tim[y1] = im[i];
	        }
	        core.fft1d(tre, tim);
	        for(var y2=0; y2<_n; y2++) {
	          i = x + y2*_n;
	          re[i] = tre[y2];
	          im[i] = tim[y2];
	        }
	      }
	    },
	    // 2D-IFFT
	    ifft2d : function(re, im) {
	      var tre = [],
	          tim = [],
	          i = 0;
	      // x-axis
	      for(var y=0; y<_n; y++) {
	        i = y*_n;
	        for(var x1=0; x1<_n; x1++) {
	          tre[x1] = re[x1 + i];
	          tim[x1] = im[x1 + i];
	        }
	        core.ifft1d(tre, tim);
	        for(var x2=0; x2<_n; x2++) {
	          re[x2 + i] = tre[x2];
	          im[x2 + i] = tim[x2];
	        }
	      }
	      // y-axis
	      for(var x=0; x<_n; x++) {
	        for(var y1=0; y1<_n; y1++) {
	          i = x + y1*_n;
	          tre[y1] = re[i];
	          tim[y1] = im[i];
	        }
	        core.ifft1d(tre, tim);
	        for(var y2=0; y2<_n; y2++) {
	          i = x + y2*_n;
	          re[i] = tre[y2];
	          im[i] = tim[y2];
	        }
	      }
	    },
	    // core operation of FFT
	    fft : function(re, im, inv) {
	      var d, h, ik, m, tmp, wr, wi, xr, xi,
	          n4 = _n >> 2;
	      // bit reversal
	      for(var l=0; l<_n; l++) {
	        m = _bitrev[l];
	        if(l < m) {
	          tmp = re[l];
	          re[l] = re[m];
	          re[m] = tmp;
	          tmp = im[l];
	          im[l] = im[m];
	          im[m] = tmp;
	        }
	      }
	      // butterfly operation
	      for(var k=1; k<_n; k<<=1) {
	        h = 0;
	        d = _n/(k << 1);
	        for(var j=0; j<k; j++) {
	          wr = _cstb[h + n4];
	          wi = inv*_cstb[h];
	          for(var i=j; i<_n; i+=(k<<1)) {
	            ik = i + k;
	            xr = wr*re[ik] + wi*im[ik];
	            xi = wr*im[ik] - wi*re[ik];
	            re[ik] = re[i] - xr;
	            re[i] += xr;
	            im[ik] = im[i] - xi;
	            im[i] += xi;
	          }
	          h += d;
	        }
	      }
	    },
	    // initialize the array (supports TypedArray)
	    _initArray : function() {
	      if(typeof Uint32Array !== 'undefined') {
	        _bitrev = new Uint32Array(_n);
	      } else {
	        _bitrev = [];
	      }
	      if(typeof Float64Array !== 'undefined') {
	        _cstb = new Float64Array(_n*1.25);
	      } else {
	        _cstb = [];
	      }
	    },
	    // zero padding
	    _paddingZero : function() {
	      // TODO
	    },
	    // makes bit reversal table
	    _makeBitReversalTable : function() {
	      var i = 0,
	          j = 0,
	          k = 0;
	      _bitrev[0] = 0;
	      while(++i < _n) {
	        k = _n >> 1;
	        while(k <= j) {
	          j -= k;
	          k >>= 1;
	        }
	        j += k;
	        _bitrev[i] = j;
	      }
	    },
	    // makes trigonometiric function table
	    _makeCosSinTable : function() {
	      var n2 = _n >> 1,
	          n4 = _n >> 2,
	          n8 = _n >> 3,
	          n2p4 = n2 + n4,
	          t = Math.sin(Math.PI/_n),
	          dc = 2*t*t,
	          ds = Math.sqrt(dc*(2 - dc)),
	          c = _cstb[n4] = 1,
	          s = _cstb[0] = 0;
	      t = 2*dc;
	      for(var i=1; i<n8; i++) {
	        c -= dc;
	        dc += t*c;
	        s += ds;
	        ds -= t*s;
	        _cstb[i] = s;
	        _cstb[n4 - i] = c;
	      }
	      if(n8 !== 0) {
	        _cstb[n8] = Math.sqrt(0.5);
	      }
	      for(var j=0; j<n4; j++) {
	        _cstb[n2 - j]  = _cstb[j];
	      }
	      for(var k=0; k<n2p4; k++) {
	        _cstb[k + n2] = -_cstb[k];
	      }
	    }
	  };
	  // aliases (public APIs)
	  var apis = ['init', 'fft1d', 'ifft1d', 'fft2d', 'ifft2d'];
	  for(var i=0; i<apis.length; i++) {
	    FFT[apis[i]] = core[apis[i]];
	  }
	  FFT.bt = core.bt1d;
	  FFT.fft = core.fft1d;
	  FFT.ifft = core.ifft1d;
	  
	  return FFT;
	}).call(this);


/***/ }
/******/ ])
});
;