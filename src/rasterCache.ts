// Persistent, content-addressable cache of rasterized Supernote page images.
// Keyed by (whole-note content hash, page number), so editing a page anywhere
// in a note only misses on that note's own pages, not other notes' — and the
// exact same .note bytes (e.g. re-opening an unedited file) always hit,
// regardless of vault path or how the page was reached (view vs. embed vs.
// export).
//
// Storage is a minimal structural interface (CacheStorage) rather than
// Obsidian's DataAdapter type directly, so this module has no dependency on
// the `obsidian` package and can be unit-tested with a plain mock. Obsidian's
// real `app.vault.adapter` satisfies it as-is (duck typing).
import { hashBytes } from './deviceSync';

export { hashBytes };

export const DEFAULT_MAX_CACHE_BYTES = 100 * 1024 * 1024;
// Separate, smaller budget for the in-memory tier (see class comment) — kept
// modest since it's on top of whatever else Obsidian and this note's own
// decoded ImageBitmaps are already holding in memory, especially on mobile.
export const DEFAULT_MAX_MEMORY_CACHE_BYTES = 20 * 1024 * 1024;

export interface CacheStorage {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    readBinary(path: string): Promise<ArrayBuffer>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    remove(path: string): Promise<void>;
}

interface CacheIndexEntry {
    key: string;
    size: number;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType = 'image/png'): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// A size-bounded, disk-backed cache of rasterized page PNGs, with a smaller
// in-memory tier in front of it.
//
// Eviction is LRU on both tiers: `entries` (disk) and `memoryCache` (memory)
// are each a Map, whose iteration order is insertion order, and every cache
// hit deletes + re-inserts its key to move it to the most-recently-used end.
// Eviction then just removes from the front — the actual least-recently-used
// entry, whether that's "oldest inserted" (an entry never re-read) or
// "longest since last read" (one that has been).
//
// The disk tier's reordering is kept in memory only — get() does not persist
// the *disk* index on a hit, only put()/clear() do. A cache *read* triggering
// a disk write would undercut the point of caching; the cost is that
// recency ordering accumulated since the last write is lost if the plugin
// reloads or Obsidian restarts before another put()/clear() happens to flush
// it, so eviction order right after a reload reflects whatever was last
// persisted rather than genuinely-most-recent reads.
//
// The memory tier exists purely to skip the disk tier's vault.adapter
// read + base64 decode for pages already served earlier this session (e.g.
// closing a note and reopening it) — it is never persisted at all, and is
// empty again after every plugin reload/Obsidian restart.
//
// Every storage operation is fail-open: a read/write/parse error is logged
// and treated as a cache miss (get) or a no-op (put/evict), never thrown, so
// a broken or unavailable cache degrades to "always re-rasterize" rather
// than breaking the plugin's actual job of rendering notes.
export class RasterCache {
    private entries = new Map<string, number>();
    private totalBytes = 0;
    private memoryCache = new Map<string, { dataUrl: string; size: number }>();
    private memoryBytes = 0;
    private dirEnsured = false;
    private persistQueue: Promise<void> = Promise.resolve();
    private readonly indexPath: string;

    private constructor(
        private readonly storage: CacheStorage,
        private readonly dir: string,
        private readonly maxBytes: number,
        private readonly maxMemoryBytes: number,
    ) {
        this.indexPath = `${dir}/index.json`;
    }

    static async open(
        storage: CacheStorage,
        dir: string,
        maxBytes: number = DEFAULT_MAX_CACHE_BYTES,
        maxMemoryBytes: number = DEFAULT_MAX_MEMORY_CACHE_BYTES,
    ): Promise<RasterCache> {
        const cache = new RasterCache(storage, dir, maxBytes, maxMemoryBytes);
        await cache.loadIndex();
        return cache;
    }

    get totalCachedBytes(): number {
        return this.totalBytes;
    }

    get entryCount(): number {
        return this.entries.size;
    }

    get memoryCachedBytes(): number {
        return this.memoryBytes;
    }

    get memoryEntryCount(): number {
        return this.memoryCache.size;
    }

    async get(noteHash: string, pageNumber: number): Promise<string | null> {
        const key = this.key(noteHash, pageNumber);

        const memoized = this.memoryCache.get(key);
        if (memoized !== undefined) {
            // Touch this tier's own LRU order too.
            this.memoryCache.delete(key);
            this.memoryCache.set(key, memoized);
            return memoized.dataUrl;
        }

        const size = this.entries.get(key);
        if (size === undefined) return null;
        try {
            const buf = await this.storage.readBinary(this.pagePath(key));
            // Move to the most-recently-used end (see class comment) — only
            // in memory, not persisted until the next put()/clear().
            this.entries.delete(key);
            this.entries.set(key, size);
            const dataUrl = bytesToDataUrl(new Uint8Array(buf));
            this.rememberInMemory(key, dataUrl, size);
            return dataUrl;
        } catch {
            // Indexed but unreadable (deleted out-of-band, corrupted, etc.) —
            // drop the stale entry and report a miss rather than throwing.
            this.entries.delete(key);
            this.totalBytes -= size;
            return null;
        }
    }

    async put(noteHash: string, pageNumber: number, dataUrl: string): Promise<void> {
        const key = this.key(noteHash, pageNumber);
        if (this.entries.has(key)) return; // already cached under this content-addressed key

        const bytes = dataUrlToBytes(dataUrl);
        try {
            await this.ensureDir();
            await this.storage.writeBinary(this.pagePath(key), toArrayBuffer(bytes));
        } catch (err) {
            console.error('Supernote rasterCache: failed to write cache entry, skipping', err);
            return;
        }

        this.entries.set(key, bytes.byteLength);
        this.totalBytes += bytes.byteLength;
        this.rememberInMemory(key, dataUrl, bytes.byteLength);
        await this.evictIfNeeded();
        await this.persist();
    }

    // Empties the cache (used by the "clear rasterization cache" command /
    // settings button). Best-effort: failures removing individual blobs are
    // swallowed since the index is cleared either way.
    async clear(): Promise<void> {
        const keys = Array.from(this.entries.keys());
        this.entries.clear();
        this.totalBytes = 0;
        this.memoryCache.clear();
        this.memoryBytes = 0;
        for (const key of keys) {
            try {
                await this.storage.remove(this.pagePath(key));
            } catch {
                // best-effort
            }
        }
        await this.persist();
    }

    private key(noteHash: string, pageNumber: number): string {
        return `${noteHash}-${pageNumber}`;
    }

    // Inserts/refreshes an entry in the memory tier and evicts
    // least-recently-used entries from *that tier only* until back under its
    // (independent, smaller) budget. Never touches disk.
    private rememberInMemory(key: string, dataUrl: string, size: number): void {
        const existing = this.memoryCache.get(key);
        if (existing) {
            this.memoryCache.delete(key);
            this.memoryBytes -= existing.size;
        }
        this.memoryCache.set(key, { dataUrl, size });
        this.memoryBytes += size;

        const toEvict: string[] = [];
        for (const [oldestKey, oldest] of this.memoryCache) {
            if (this.memoryBytes <= this.maxMemoryBytes) break;
            toEvict.push(oldestKey);
            this.memoryBytes -= oldest.size;
        }
        for (const oldestKey of toEvict) {
            this.memoryCache.delete(oldestKey);
        }
    }

    private pagePath(key: string): string {
        return `${this.dir}/${key}.png`;
    }

    private async loadIndex(): Promise<void> {
        try {
            if (!(await this.storage.exists(this.indexPath))) return;
            const buf = await this.storage.readBinary(this.indexPath);
            const parsed = JSON.parse(new TextDecoder().decode(buf)) as { entries?: CacheIndexEntry[] };
            for (const entry of parsed.entries ?? []) {
                this.entries.set(entry.key, entry.size);
                this.totalBytes += entry.size;
            }
        } catch (err) {
            console.error('Supernote rasterCache: failed to load cache index, starting empty', err);
            this.entries.clear();
            this.totalBytes = 0;
        }
    }

    // Evicts least-recently-used entries (Map iteration order == recency
    // order, see class comment) until back under budget. A single entry
    // larger than the whole budget is left in place once everything else has
    // been evicted — this is a best-effort cap, not a hard invariant.
    private async evictIfNeeded(): Promise<void> {
        const toRemove: string[] = [];
        for (const [key, size] of this.entries) {
            if (this.totalBytes <= this.maxBytes) break;
            toRemove.push(key);
            this.totalBytes -= size;
        }
        for (const key of toRemove) {
            this.entries.delete(key);
            try {
                await this.storage.remove(this.pagePath(key));
            } catch {
                // best-effort
            }
        }
    }

    // Persists the index after every mutation, chained onto a single queue so
    // concurrent put()/clear() calls' writes serialize instead of racing to
    // overwrite index.json with a stale snapshot.
    private persist(): Promise<void> {
        this.persistQueue = this.persistQueue.then(() => this.writeIndex());
        return this.persistQueue;
    }

    private async writeIndex(): Promise<void> {
        const entries: CacheIndexEntry[] = Array.from(this.entries, ([key, size]) => ({ key, size }));
        const json = JSON.stringify({ entries });
        try {
            await this.ensureDir();
            await this.storage.writeBinary(this.indexPath, toArrayBuffer(new TextEncoder().encode(json)));
        } catch (err) {
            console.error('Supernote rasterCache: failed to persist cache index', err);
        }
    }

    private async ensureDir(): Promise<void> {
        if (this.dirEnsured) return;
        try {
            if (!(await this.storage.exists(this.dir))) {
                await this.storage.mkdir(this.dir);
            }
        } catch {
            // ignore races against another mkdir/existing dir
        }
        this.dirEnsured = true;
    }
}
