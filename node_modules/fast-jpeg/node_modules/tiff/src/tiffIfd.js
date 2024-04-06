'use strict';

const Ifd = require('./ifd');

const dateTimeRegex = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

class TiffIfd extends Ifd {
    constructor() {
        super('standard');
    }

    // Custom fields
    get size() {
        return this.width * this.height;
    }
    get width() {
        return this.imageWidth;
    }
    get height() {
        return this.imageLength;
    }
    get components() {
        return this.samplesPerPixel;
    }
    get date() {
        var date = new Date();
        var result = dateTimeRegex.exec(this.dateTime);
        date.setFullYear(result[1], result[2] - 1, result[3]);
        date.setHours(result[4], result[5], result[6]);
        return date;
    }

    // IFD fields
    get newSubfileType() {
        return this.get(254);
    }
    get imageWidth() {
        return this.get(256);
    }
    get imageLength() {
        return this.get(257);
    }
    get bitsPerSample() {
        return this.get(258);
    }
    get compression() {
        return this.get(259) || 1;
    }
    get type() {
        return this.get(262);
    }
    get fillOrder() {
        return this.get(266) || 1;
    }
    get documentName() {
        return this.get(269);
    }
    get imageDescription() {
        return this.get(270);
    }
    get stripOffsets() {
        return alwaysArray(this.get(273));
    }
    get orientation() {
        return this.get(274);
    }
    get samplesPerPixel() {
        return this.get(277);
    }
    get rowsPerStrip() {
        return this.get(278);
    }
    get stripByteCounts() {
        return alwaysArray(this.get(279));
    }
    get minSampleValue() {
        return this.get(280) || 0;
    }
    get maxSampleValue() {
        return this.get(281) || Math.pow(2, this.bitsPerSample) - 1;
    }
    get xResolution() {
        return this.get(282);
    }
    get yResolution() {
        return this.get(283);
    }
    get planarConfiguration() {
        return this.get(284) || 1;
    }
    get resolutionUnit() {
        return this.get(296) || 2;
    }
    get dateTime() {
        return this.get(306);
    }
    get predictor() {
        return this.get(317) || 1;
    }
    get sampleFormat() {
        return this.get(339) || 1;
    }
    get sMinSampleValue() {
        return this.get(340) || this.minSampleValue;
    }
    get sMaxSampleValue() {
        return this.get(341) || this.maxSampleValue;
    }
}

function alwaysArray(value) {
    if (typeof value === 'number') return [value];
    return value;
}

module.exports = TiffIfd;
