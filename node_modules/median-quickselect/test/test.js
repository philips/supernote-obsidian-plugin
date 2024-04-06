const assert = require('assert');
const quickSelect = require('../lib/median-quickselect.min');
const randomArray = require('./randomArray');

const median = values => values.sort((a, b) => b - a)[Math.floor(values.length / 2)];

const lengths = [0, 1, 2, 3, 4, 5, 10, 100, 999, 1000, 5000, 1000 * 1000];

describe('check median-quickselect result', () => {

    lengths.forEach(len => {

        const data = randomArray(len);
        const copy = data.slice();

        it(
            `should equal dumb median result on array of length ${len}`,
            () => assert.equal(quickSelect(data), median(copy))
        );
    })
});




