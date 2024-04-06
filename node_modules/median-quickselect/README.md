# median-quickselect
[![NPM](https://nodei.co/npm/median-quickselect.png)](https://npmjs.org/package/median-quickselect)

Fast implementation of lower median search using Quick select algorithm. Ported from [this C implementation](http://ndevilla.free.fr/median/median/src/quickselect.c).

Please read ["Fast median search: an ANSI C implementation"](http://ndevilla.free.fr/median/median/) by Nicolas Devillard for more info.

Note that result can be different from other packages, as `median-quickselect` calculates lower median, because taking an average of the two central elements requires two calls to the routine, doubling the processing time.
## Installation
Install from npm:
```shell
npm install --save median-quickselect
```
Or hot-link via [unpkg.com](https://unpkg.com/)
```html
<script src="https://unpkg.com/median-quickselect"></script>
```
## Usage
```js
const median = require('median-quickselect');
median([1, 4, 10, 2, 5, 0, -5]); // 2
```
Note that the  **order of elements ** on array passed to `median()` will be  **changed** after call.
## Benchmark
```
$ npm run bench                                                                                                                                                                       1001 ms  master 

> node test/benchmark.js

benchmarking dataset of 100 numbers
median: 0.891ms
fast-median: 0.999ms
compute-median: 0.269ms
stats-median: 0.159ms
median-quickselect: 0.230ms

benchmarking dataset of 1000 numbers
median: 0.849ms
fast-median: 1.713ms
compute-median: 0.562ms
stats-median: 0.210ms
median-quickselect: 0.204ms

benchmarking dataset of 10000 numbers
median: 6.249ms
fast-median: 9.413ms
compute-median: 5.816ms
stats-median: 5.101ms
median-quickselect: 2.027ms

benchmarking dataset of 1000000 numbers
median: 576.688ms
fast-median: 886.843ms
compute-median: 786.714ms
stats-median: 662.177ms
median-quickselect: 13.027ms

benchmarking dataset of 10000000 numbers
median: 6347.193ms
fast-median: 8722.377ms
compute-median: 7278.490ms
stats-median: 7089.452ms
median-quickselect: 119.298ms
```