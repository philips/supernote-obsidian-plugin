// Talks to a single atelierComposite.worker.ts instance - the `.spd`
// equivalent of imageConverter.ts's WorkerPool, but deliberately much
// simpler: that pool exists to bound memory/parallelism across many
// concurrent/rapid per-page requests during fast scrolling through a long
// document (issue #154). A `.spd` file has no such access pattern - it's
// opened once and re-composited only one at a time, on an explicit layer-
// toggle click - so one dedicated worker per loaded file (created lazily,
// reused across that same file's own re-composites, torn down when the
// owning element disconnects) is simple and sufficient. Deliberately free
// of any `obsidian` import, same as imageConverter.ts - see issue #183.
import { IAtelierSurfaceName } from 'supernote-typescript';
import { AtelierComposite, AtelierLayerOption } from './atelierRenderer';
import Worker from 'atelierComposite.worker';
import { AtelierWorkerMessage, AtelierWorkerResponse } from '../atelierComposite.worker';

export class AtelierWorkerClient {
    private worker: Worker | null = null;
    // Chains every request through this one worker so a call started
    // before a previous one's response arrives can't send two messages
    // before the first reply comes back and have onmessage resolve the
    // wrong one - the single-worker equivalent of WorkerPool's own
    // per-worker queue (imageConverter.ts's processChunk()), just without
    // needing to pick *which* worker first.
    private queue: Promise<unknown> = Promise.resolve();

    private send<T extends AtelierWorkerResponse>(message: AtelierWorkerMessage, transfer?: Transferable[]): Promise<T> {
        if (!this.worker) this.worker = new Worker();
        const worker = this.worker;

        const result = this.queue.then(() => new Promise<T>((resolve, reject) => {
            worker.onmessage = (e: MessageEvent<AtelierWorkerResponse>) => {
                if (e.data.type === 'error') reject(new Error(e.data.error));
                else resolve(e.data as T);
            };
            worker.onerror = (err) => reject(new Error(err.message));
            worker.postMessage(message, transfer ?? []);
        }));
        // Marks the queue free again once this request settles, regardless
        // of outcome - same reasoning as WorkerPool's identical pattern: a
        // failed request shouldn't leave the next one waiting forever, and
        // `result` (what this call actually returns) still carries the
        // rejection to its own caller.
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    // Parses `buffer` in the worker and keeps the result alive there for
    // every composite() call that follows, until open() is called again
    // (a reload) or dispose() tears the worker down. Transfers `buffer`'s
    // backing memory to the worker rather than structured-cloning it - it's
    // never needed on the main thread again once handed off.
    async open(buffer: Uint8Array): Promise<AtelierLayerOption[]> {
        const response = await this.send<Extract<AtelierWorkerResponse, { type: 'opened' }>>(
            { type: 'open', buffer },
            [buffer.buffer as ArrayBuffer],
        );
        return response.layers;
    }

    async composite(visibleSurfaces: Iterable<IAtelierSurfaceName>): Promise<AtelierComposite | null> {
        const response = await this.send<Extract<AtelierWorkerResponse, { type: 'composite-result' }>>(
            { type: 'composite', visibleSurfaces: [...visibleSurfaces] },
        );
        return response.composite;
    }

    // Terminates the underlying worker (if one was ever created) - safe to
    // call more than once, and safe to call before open() has ever run.
    // The next open() after this lazily spins up a brand new worker.
    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        this.queue = Promise.resolve();
    }
}
