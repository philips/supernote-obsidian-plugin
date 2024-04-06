import BaseRegression from 'ml-regression-base';

declare namespace SimpleLinearRegression {
  export interface SLRModel {
    name: 'simpleLinearRegression';
  }
}

declare class SimpleLinearRegression extends BaseRegression {
  slope: number;
  intercept: number;
  coefficients: [number, number];

  constructor(x: number[], y: number[]);

  static load(model: SimpleLinearRegression.SLRModel): SimpleLinearRegression;

  computeX(y: number): number;
  toJSON(): SimpleLinearRegression.SLRModel;
}

export = SimpleLinearRegression;
