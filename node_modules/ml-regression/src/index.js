import PotentialRegression from './regression/potential-regression';

export {
  default as SimpleLinearRegression,
  default as SLR
} from 'ml-regression-simple-linear';
export { default as PolynomialRegression } from 'ml-regression-polynomial';
export { default as ExponentialRegression } from 'ml-regression-exponential';
export { default as PowerRegression } from 'ml-regression-power';
export {
  default as MultivariateLinearRegression
} from 'ml-regression-multivariate-linear';
const NLR = {
  PotentialRegression
};
export { NLR, NLR as NonLinearRegression };

export {
  default as KernelRidgeRegression,
  default as KRR
} from './regression/kernel-ridge-regression';
export {
  default as PolinomialFitting2D
} from './regression/poly-fit-regression2d';

// robust regressions
export { default as TheilSenRegression } from 'ml-regression-theil-sen';
export {
  default as RobustPolynomialRegression
} from 'ml-regression-robust-polynomial';
