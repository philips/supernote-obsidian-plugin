import { IFDKind, DataArray } from './types';
export default class IFD {
    kind: IFDKind;
    data: DataArray;
    fields: Map<number, any>;
    exif: IFD | undefined;
    gps: IFD | undefined;
    private _hasMap;
    private _map;
    constructor(kind: IFDKind);
    get(tag: number | string): any;
    get map(): Record<string, any>;
}
