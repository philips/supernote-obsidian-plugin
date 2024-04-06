'use strict';

const { Matrix, MatrixTransposeView } = require('ml-matrix');
const GaussianKernel = require('ml-kernel-gaussian');
const PolynomialKernel = require('ml-kernel-polynomial');
const SigmoidKernel = require('ml-kernel-sigmoid');

const ANOVAKernel = require('./kernels/anova-kernel');
const CauchyKernel = require('./kernels/cauchy-kernel');
const ExponentialKernel = require('./kernels/exponential-kernel');
const HistogramKernel = require('./kernels/histogram-intersection-kernel');
const LaplacianKernel = require('./kernels/laplacian-kernel');
const MultiquadraticKernel = require('./kernels/multiquadratic-kernel');
const RationalKernel = require('./kernels/rational-quadratic-kernel');

const kernelType = {
  gaussian: GaussianKernel,
  rbf: GaussianKernel,
  polynomial: PolynomialKernel,
  poly: PolynomialKernel,
  anova: ANOVAKernel,
  cauchy: CauchyKernel,
  exponential: ExponentialKernel,
  histogram: HistogramKernel,
  min: HistogramKernel,
  laplacian: LaplacianKernel,
  multiquadratic: MultiquadraticKernel,
  rational: RationalKernel,
  sigmoid: SigmoidKernel,
  mlp: SigmoidKernel
};

class Kernel {
  constructor(type, options) {
    this.kernelType = type;
    if (type === 'linear') return;

    if (typeof type === 'string') {
      type = type.toLowerCase();

      var KernelConstructor = kernelType[type];
      if (KernelConstructor) {
        this.kernelFunction = new KernelConstructor(options);
      } else {
        throw new Error(`unsupported kernel type: ${type}`);
      }
    } else if (typeof type === 'object' && typeof type.compute === 'function') {
      this.kernelFunction = type;
    } else {
      throw new TypeError(
        'first argument must be a valid kernel type or instance'
      );
    }
  }

  compute(inputs, landmarks) {
    inputs = Matrix.checkMatrix(inputs);
    if (landmarks === undefined) {
      landmarks = inputs;
    } else {
      landmarks = Matrix.checkMatrix(landmarks);
    }
    if (this.kernelType === 'linear') {
      return inputs.mmul(new MatrixTransposeView(landmarks));
    }

    const kernelMatrix = new Matrix(inputs.rows, landmarks.rows);
    if (inputs === landmarks) {
      // fast path, matrix is symmetric
      for (let i = 0; i < inputs.rows; i++) {
        for (let j = i; j < inputs.rows; j++) {
          const value = this.kernelFunction.compute(
            inputs.getRow(i),
            inputs.getRow(j)
          );
          kernelMatrix.set(i, j, value);
          kernelMatrix.set(j, i, value);
        }
      }
    } else {
      for (let i = 0; i < inputs.rows; i++) {
        for (let j = 0; j < landmarks.rows; j++) {
          kernelMatrix.set(
            i,
            j,
            this.kernelFunction.compute(inputs.getRow(i), landmarks.getRow(j))
          );
        }
      }
    }
    return kernelMatrix;
  }
}

module.exports = Kernel;
