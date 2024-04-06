import Ifd from './ifd';

// eslint-disable-next-line prefer-named-capture-group
const dateTimeRegex = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export default class TiffIfd extends Ifd {
  public constructor() {
    super('standard');
  }

  // Custom fields
  public get size(): number {
    return this.width * this.height;
  }
  public get width(): number {
    return this.imageWidth;
  }
  public get height(): number {
    return this.imageLength;
  }
  public get components(): number {
    return this.samplesPerPixel;
  }
  public get date(): Date {
    let date = new Date();
    let result = dateTimeRegex.exec(this.dateTime);
    if (result === null) {
      throw new Error(`invalid dateTime: ${this.dateTime}`);
    }
    date.setFullYear(
      Number(result[1]),
      Number(result[2]) - 1,
      Number(result[3]),
    );
    date.setHours(Number(result[4]), Number(result[5]), Number(result[6]));
    return date;
  }

  // IFD fields
  public get newSubfileType(): number {
    return this.get('NewSubfileType');
  }
  public get imageWidth(): number {
    return this.get('ImageWidth');
  }
  public get imageLength(): number {
    return this.get('ImageLength');
  }
  public get bitsPerSample(): number {
    const data = this.get('BitsPerSample');
    if (data && typeof data !== 'number') {
      return data[0];
    }
    return data;
  }
  public get alpha(): boolean {
    const extraSamples = this.extraSamples;
    if (!extraSamples) return false;
    return extraSamples[0] !== 0;
  }
  public get associatedAlpha(): boolean {
    const extraSamples = this.extraSamples;
    if (!extraSamples) return false;
    return extraSamples[0] === 1;
  }
  public get extraSamples(): number[] | undefined {
    return alwaysArray(this.get('ExtraSamples'));
  }
  public get compression(): number {
    return this.get('Compression') || 1;
  }
  public get type(): number {
    return this.get('PhotometricInterpretation');
  }
  public get fillOrder(): number {
    return this.get('FillOrder') || 1;
  }
  public get documentName(): string | undefined {
    return this.get('DocumentName');
  }
  public get imageDescription(): string | undefined {
    return this.get('ImageDescription');
  }
  public get stripOffsets(): number[] {
    return alwaysArray(this.get('StripOffsets'));
  }
  public get orientation(): number {
    return this.get('Orientation');
  }
  public get samplesPerPixel(): number {
    return this.get('SamplesPerPixel') || 1;
  }
  public get rowsPerStrip(): number {
    return this.get('RowsPerStrip');
  }
  public get stripByteCounts(): number[] {
    return alwaysArray(this.get('StripByteCounts'));
  }
  public get minSampleValue(): number {
    return this.get('MinSampleValue') || 0;
  }
  public get maxSampleValue(): number {
    return this.get('MaxSampleValue') || Math.pow(2, this.bitsPerSample) - 1;
  }
  public get xResolution(): number {
    return this.get('XResolution');
  }
  public get yResolution(): number {
    return this.get('YResolution');
  }
  public get planarConfiguration(): number {
    return this.get('PlanarConfiguration') || 1;
  }
  public get resolutionUnit(): number {
    return this.get('ResolutionUnit') || 2;
  }
  public get dateTime(): string {
    return this.get('DateTime');
  }
  public get predictor(): number {
    return this.get('Predictor') || 1;
  }
  public get sampleFormat(): number {
    return this.get('SampleFormat') || 1;
  }
  public get sMinSampleValue(): number {
    return this.get('SMinSampleValue') || this.minSampleValue;
  }
  public get sMaxSampleValue(): number {
    return this.get('SMaxSampleValue') || this.maxSampleValue;
  }
  public get palette(): [number, number, number][] | undefined {
    const totalColors = 2 ** this.bitsPerSample;
    const colorMap: number[] = this.get('ColorMap');
    if (!colorMap) return undefined;
    if (colorMap.length !== 3 * totalColors) {
      throw new Error(`ColorMap size must be ${totalColors}`);
    }
    const palette: [number, number, number][] = [];
    for (let i = 0; i < totalColors; i++) {
      palette.push([
        colorMap[i],
        colorMap[i + totalColors],
        colorMap[i + 2 * totalColors],
      ]);
    }
    return palette;
  }
}

function alwaysArray(value: number | number[]): number[] {
  if (typeof value === 'number') return [value];
  return value;
}
