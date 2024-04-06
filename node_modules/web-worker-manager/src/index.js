'use strict';

var workerTemplate = require('./workerTemplate');

var CORES = navigator.hardwareConcurrency || 1;

var noop = Function.prototype;

function WorkerManager(func, options) {
    // Check arguments
    if (typeof func !== 'string' && typeof func !== 'function')
        throw new TypeError('func argument must be a function');
    if (options === undefined)
        options = {};
    if (typeof options !== 'object' || options === null)
        throw new TypeError('options argument must be an object');

    this._workerCode = func.toString();

    // Parse options
    if (options.maxWorkers === undefined || options.maxWorkers === 'auto') {
        this._numWorkers = Math.min(CORES - 1, 1);
    } else if (options.maxWorkers > 0) {
        this._numWorkers = Math.min(options.maxWorkers, CORES);
    } else {
        this._numWorkers = CORES;
    }

    this._workers = new Map();
    this._timeout = options.timeout || 0;
    this._terminateOnError = !!options.terminateOnError;

    var deps = options.deps;
    if (typeof deps === 'string')
        deps = [deps];
    if (!Array.isArray(deps))
        deps = undefined;

    this._id = 0;
    this._terminated = false;
    this._working = 0;
    this._waiting = [];

    this._init(deps);
}

WorkerManager.prototype._init = function (deps) {
    var workerURL = workerTemplate.newWorkerURL(this._workerCode, deps);

    for (var i = 0; i < this._numWorkers; i++) {
        var worker = new Worker(workerURL);
        worker.onmessage = this._onmessage.bind(this, worker);
        worker.onerror = this._onerror.bind(this, worker);
        worker.running = false;
        worker.id = i;
        this._workers.set(worker, null);
    }

    URL.revokeObjectURL(workerURL);
};

WorkerManager.prototype._onerror = function (worker, error) {
    if (this._terminated)
        return;
    this._working--;
    worker.running = false;
    var callback = this._workers.get(worker);
    if (callback) {
        callback[1](error.message);
    }
    this._workers.set(worker, null);
    if (this._terminateOnError) {
        this.terminate();
    } else {
        this._exec();
    }
};

WorkerManager.prototype._onmessage = function (worker, event) {
    if (this._terminated)
        return;
    this._working--;
    worker.running = false;
    var callback = this._workers.get(worker);
    if (callback) {
        callback[0](event.data.data);
    }
    this._workers.set(worker, null);
    this._exec();
};

WorkerManager.prototype._exec = function () {
    for (var worker of this._workers.keys()) {
        if (this._working === this._numWorkers ||
            this._waiting.length === 0) {
            return;
        }
        if (!worker.running) {
            for (var i = 0; i < this._waiting.length; i++) {
                var execInfo = this._waiting[i];
                if (typeof execInfo[4] === 'number' && execInfo[4] !== worker.id) {
                    // this message is intended to another worker, let's ignore it
                    continue;
                }
                this._waiting.splice(i, 1);
                worker.postMessage({
                    action: 'exec',
                    event: execInfo[0],
                    args: execInfo[1]
                }, execInfo[2]);
                worker.running = true;
                worker.time = Date.now();
                this._workers.set(worker, execInfo[3]);
                this._working++;
                break;
            }
        }
    }
};

WorkerManager.prototype.terminate = function () {
    if (this._terminated) return;
    for (var entry of this._workers) {
        entry[0].terminate();
        if (entry[1]) {
            entry[1][1](new Error('Terminated'));
        }
    }
    this._workers.clear();
    this._waiting = [];
    this._working = 0;
    this._terminated = true;
};

WorkerManager.prototype.postAll = function (event, args) {
    if (this._terminated)
        throw new Error('Cannot post (terminated)');
    var promises = [];
    for (var worker of this._workers.keys()) {
        promises.push(this.post(event, args, [], worker.id));
    }
    return Promise.all(promises);
};

WorkerManager.prototype.post = function (event, args, transferable, id) {
    if (args === undefined) args = [];
    if (transferable === undefined) transferable = [];
    if (!Array.isArray(args)) {
        args = [args];
    }
    if (!Array.isArray(transferable)) {
        transferable = [transferable];
    }

    var self = this;
    return new Promise(function (resolve, reject) {
        if (self._terminated) throw new Error('Cannot post (terminated)');
        self._waiting.push([event, args, transferable, [resolve, reject], id]);
        self._exec();
    });
};

module.exports = WorkerManager;
