const median = require('median');
const fastMedian = require('fast-median');
const computeMedian = require('compute-median');
const statsMedian = require('stats-median');
const quickSelect = require('../lib/median-quickselect.min');
const randomArray = require('./randomArray');


[100, 1000, 10 * 1000, 1000 * 1000, 10 * 1000 * 1000].forEach(len => {

    console.log(`benchmarking dataset of ${len} numbers`);
    const data = randomArray(len);

    const measureTime = (medianFunc, title) => {
        let dataCopy = data.slice();
        console.time(title);
        medianFunc(dataCopy);
        console.timeEnd(title);
    };

    measureTime(median, 'median');
    measureTime(fastMedian, 'fast-median');
    measureTime(computeMedian, 'compute-median');
    measureTime(statsMedian.calc, 'stats-median');
    measureTime(quickSelect, 'median-quickselect');

    console.log();
});





