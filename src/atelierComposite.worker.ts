import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { IAtelierSurfaceName } from 'supernote-typescript';
import { AtelierComposite, AtelierLayerOption, atelierLayerOptions, compositeImage, openAtelierBuffer } from './render/atelierRenderer';

export { };

// Parsing + compositing for `.spd` (Supernote Atelier) files - the
// `.spd` equivalent of rasterize.worker.ts. Unlike that worker (stateless:
// every message carries its own minimal page slice, see
// extractPagesRenderData()'s comment in render/imageConverter.ts for why),
// this one is deliberately stateful: `open` parses the file once and keeps
// the resulting SupernoteAtelier instance alive in this worker's own scope
// for every `composite` message that follows, so a layer-visibility toggle
// only ever re-runs the actual compositing (image-js tile decode/paste),
// not the sqlite parse too. Safe because exactly one file is ever open per
// worker instance - see render/atelierWorkerClient.ts, which owns exactly
// one worker per <supernote-atelier-viewer> element and re-uses it across
// that element's own file reloads (a later `open` message just replaces
// this variable).
export type AtelierWorkerMessage =
    { type: 'open'; buffer: Uint8Array }
    | { type: 'composite'; visibleSurfaces: IAtelierSurfaceName[] };

export type AtelierWorkerResponse =
    | { type: 'opened'; layers: AtelierLayerOption[] }
    | { type: 'composite-result'; composite: AtelierComposite | null }
    | { type: 'error'; error: string };

// Deliberately not `SupernoteAtelier | null` reset between messages - see
// this file's own header comment for why staying alive across `composite`
// messages (not re-parsing per request) is the whole point.
let spd: Awaited<ReturnType<typeof openAtelierBuffer>> | null = null;

self.onmessage = async (e: MessageEvent<AtelierWorkerMessage>) => {
    try {
        const data = e.data;
        if (data.type === 'open') {
            spd = await openAtelierBuffer(data.buffer);
            const response: AtelierWorkerResponse = { type: 'opened', layers: atelierLayerOptions(spd) };
            self.postMessage(response);
            return;
        }

        // 'composite' - AtelierWorkerClient never sends this before a
        // matching 'open' (see its own send()'s queue), so a null spd here
        // would only mean a real bug on the client side, worth surfacing
        // as an error rather than silently no-op-ing.
        if (!spd) throw new Error('Received a composite request before any file was opened.');
        const composite = await compositeImage(spd, data.visibleSurfaces);
        const response: AtelierWorkerResponse = { type: 'composite-result', composite };
        self.postMessage(response);
    } catch (error) {
        const response: AtelierWorkerResponse = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
        self.postMessage(response);
    }
};
