import { AbstractMatrix, Matrix } from 'ml-matrix';

declare namespace MultivariateLinearRegression {
  export interface MLRModel {
    name: 'multivariateLinearRegression';
  }

  export interface MLROptions {
    intercept?: boolean;
    statistics?: boolean;
  }
}

declare class MultivariateLinearRegression {
  stdError: number;
  stdErrorMatrix: Matrix;
  stdErrors: number[];
  tStats: number[];
  weights: number[][];

  constructor(
    x: number[][] | AbstractMatrix,
    y: number[][] | AbstractMatrix,
    options?: MultivariateLinearRegression.MLROptions,
  );

  static load(
    model: MultivariateLinearRegression.MLRModel,
  ): MultivariateLinearRegression;

  predict(x: number[]): number[];
  predict(x: number[][]): number[][];
  predict(x: AbstractMatrix): Matrix;
  toJSON(): MultivariateLinearRegression.MLRModel;
}

export = MultivariateLinearRegression;
