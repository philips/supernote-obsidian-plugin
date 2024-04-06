import { Matrix, solve } from 'ml-matrix';
import Kernel from 'ml-kernel';
import BaseRegression from 'ml-regression-base';

const defaultOptions = {
  lambda: 0.1,
  kernelType: 'gaussian',
  kernelOptions: {},
  computeCoefficient: false
};

// Implements the Kernel ridge regression algorithm.
// http://www.ics.uci.edu/~welling/classnotes/papers_class/Kernel-Ridge.pdf
export default class KernelRidgeRegression extends BaseRegression {
  constructor(inputs, outputs, options) {
    super();
    if (inputs === true) {
      // reloading model
      this.alpha = outputs.alpha;
      this.inputs = outputs.inputs;
      this.kernelType = outputs.kernelType;
      this.kernelOptions = outputs.kernelOptions;
      this.kernel = new Kernel(outputs.kernelType, outputs.kernelOptions);
    } else {
      inputs = Matrix.checkMatrix(inputs);
      options = Object.assign({}, defaultOptions, options);

      const kernelFunction = new Kernel(
        options.kernelType,
        options.kernelOptions
      );
      const K = kernelFunction.compute(inputs);
      const n = inputs.rows;
      K.add(Matrix.eye(n, n).mul(options.lambda));

      this.alpha = solve(K, outputs);
      this.inputs = inputs;
      this.kernelType = options.kernelType;
      this.kernelOptions = options.kernelOptions;
      this.kernel = kernelFunction;
    }
  }

  _predict(newInputs) {
    return this.kernel
      .compute([newInputs], this.inputs)
      .mmul(this.alpha)
      .getRow(0);
  }

  toJSON() {
    return {
      name: 'kernelRidgeRegression',
      alpha: this.alpha,
      inputs: this.inputs,
      kernelType: this.kernelType,
      kernelOptions: this.kernelOptions
    };
  }

  static load(json) {
    if (json.name !== 'kernelRidgeRegression') {
      throw new TypeError('not a KRR model');
    }
    return new KernelRidgeRegression(true, json);
  }
}
