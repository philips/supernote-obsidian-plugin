'use strict';

var worker = function () {
    var window = self.window = self;
    function ManagedWorker() {
        this._listeners = {};
    }
    ManagedWorker.prototype.on = function (event, callback) {
        if (this._listeners[event])
            throw new RangeError('there is already a listener for ' + event);
        if (typeof callback !== 'function')
            throw new TypeError('callback argument must be a function');
        this._listeners[event] = callback;
    };
    ManagedWorker.prototype._send = function (id, data, transferable) {
        if (transferable === undefined) {
            transferable = [];
        } else if (!Array.isArray(transferable)) {
            transferable = [transferable];
        }
        self.postMessage({
            id: id,
            data: data
        }, transferable);
    };
    ManagedWorker.prototype._trigger = function (event, args) {
        if (!this._listeners[event])
            throw new Error('event ' + event + ' is not defined');
        this._listeners[event].apply(null, args);
    };
    var worker = new ManagedWorker();
    self.onmessage = function (event) {
        switch(event.data.action) {
            case 'exec':
                event.data.args.unshift(function (data, transferable) {
                    worker._send(event.data.id, data, transferable);
                });
                worker._trigger(event.data.event, event.data.args);
                break;
            case 'ping':
                worker._send(event.data.id, 'pong');
                break;
            default:
                throw new Error('unexpected action: ' + event.data.action);
        }
    };
    "CODE";
};

var workerStr = worker.toString().split('"CODE";');

exports.newWorkerURL = function newWorkerURL(code, deps) {
    var blob = new Blob(['(', workerStr[0], 'importScripts.apply(self, ' + JSON.stringify(deps) + ');\n', '(', code, ')();', workerStr[1], ')();'], {type: 'application/javascript'});
    return URL.createObjectURL(blob);
};
