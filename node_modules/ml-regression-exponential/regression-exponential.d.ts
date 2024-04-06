import BaseRegression from 'ml-regression-base';

declare namespace ExponentialRegression {
  export interface ExponentialRegressionModel {
    name: 'exponentialRegression';
  }
}

declare class ExponentialRegression extends BaseRegression {
  constructor(x: number[], y: number[]);

  static load(model: ExponentialRegression.ExponentialRegressionModel): ExponentialRegression;

  toJSON(): ExponentialRegression.ExponentialRegressionModel;
}

export = ExponentialRegression;
