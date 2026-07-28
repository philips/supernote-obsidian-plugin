import { describe, it, expect, vi } from 'vitest';
import { RasterCache, hashBytes, CacheStorage } from './rasterCache';

function makeStorage(): CacheStorage & { files: Map<string, ArrayBuffer> } {
    const files = new Map<string, ArrayBuffer>();
    const dirs = new Set<string>();
    return {
        files,
        async exists(path: string) {
            return files.has(path) || dirs.has(path);
        },
        async mkdir(path: string) {
            dirs.add(path);
        },
        async readBinary(path: string) {
            const buf = files.get(path);
            if (!buf) throw new Error(`not found: ${path}`);
            return buf;
        },
        async writeBinary(path: string, data: ArrayBuffer) {
            files.set(path, data);
        },
        async remove(path: string) {
            if (!files.delete(path)) throw new Error(`not found: ${path}`);
        },
    };
}

function dataUrlOf(byteValues: number[]): string {
    let binary = '';
    for (const b of byteValues) binary += String.fromCharCode(b);
    return `data:image/png;base64,${btoa(binary)}`;
}

describe('RasterCache', () => {
    it('misses on an empty cache', async () => {
        const cache = await RasterCache.open(makeStorage(), 'cache');
        expect(await cache.get('hash1', 1)).toBeNull();
    });

    it('round-trips a put through get', async () => {
        const cache = await RasterCache.open(makeStorage(), 'cache');
        const dataUrl = dataUrlOf([1, 2, 3, 4, 5]);
        await cache.put('hash1', 1, dataUrl);
        expect(await cache.get('hash1', 1)).toBe(dataUrl);
    });

    it('keys are independent per note hash and per page number', async () => {
        const cache = await RasterCache.open(makeStorage(), 'cache');
        await cache.put('hashA', 1, dataUrlOf([1]));
        expect(await cache.get('hashA', 2)).toBeNull();
        expect(await cache.get('hashB', 1)).toBeNull();
    });

    it('tracks total size and entry count', async () => {
        const cache = await RasterCache.open(makeStorage(), 'cache');
        await cache.put('hashA', 1, dataUrlOf([1, 2, 3]));
        await cache.put('hashA', 2, dataUrlOf([1, 2, 3, 4, 5]));
        expect(cache.entryCount).toBe(2);
        expect(cache.totalCachedBytes).toBe(8);
    });

    it('evicts the least-recently-used entry once over budget (no reads yet == oldest-inserted)', async () => {
        // maxMemoryBytes: 0 disables the in-memory tier so this test exercises
        // disk-tier eviction only — see the "memory tier" tests below for that.
        const cache = await RasterCache.open(makeStorage(), 'cache', 10, 0);
        await cache.put('hash', 1, dataUrlOf([0, 0, 0, 0])); // 4 bytes, total 4
        await cache.put('hash', 2, dataUrlOf([0, 0, 0, 0])); // total 8
        await cache.put('hash', 3, dataUrlOf([0, 0, 0, 0])); // total 12 > 10 -> evict page 1

        expect(await cache.get('hash', 1)).toBeNull();
        expect(await cache.get('hash', 2)).not.toBeNull();
        expect(await cache.get('hash', 3)).not.toBeNull();
        expect(cache.totalCachedBytes).toBeLessThanOrEqual(10);
    });

    it('re-fetching a page via get() protects it from eviction (LRU, not FIFO)', async () => {
        const cache = await RasterCache.open(makeStorage(), 'cache', 10, 0);
        await cache.put('hash', 1, dataUrlOf([0, 0, 0, 0]));
        await cache.put('hash', 2, dataUrlOf([0, 0, 0, 0]));
        // Re-access page 1 — this should now make page 2 the least-recently-used.
        expect(await cache.get('hash', 1)).not.toBeNull();
        await cache.put('hash', 3, dataUrlOf([0, 0, 0, 0])); // total 12 > 10 -> evict page 2

        expect(await cache.get('hash', 2)).toBeNull();
        expect(cache.entryCount).toBe(2);
    });

    it('persists the index across separate RasterCache.open() calls on the same storage', async () => {
        const storage = makeStorage();
        const cache1 = await RasterCache.open(storage, 'cache');
        await cache1.put('hash', 1, dataUrlOf([9, 9, 9]));

        const cache2 = await RasterCache.open(storage, 'cache');
        expect(cache2.entryCount).toBe(1);
        expect(cache2.totalCachedBytes).toBe(3);
        expect(await cache2.get('hash', 1)).toBe(dataUrlOf([9, 9, 9]));
    });

    it('fails open when writing a cache entry throws', async () => {
        const storage = makeStorage();
        const cache = await RasterCache.open(storage, 'cache');
        vi.spyOn(storage, 'writeBinary').mockRejectedValueOnce(new Error('disk full'));

        await expect(cache.put('hash', 1, dataUrlOf([1]))).resolves.toBeUndefined();
        expect(await cache.get('hash', 1)).toBeNull();
        expect(cache.entryCount).toBe(0);
    });

    it('fails open (and self-heals the index) when a cached blob goes missing out-of-band', async () => {
        const storage = makeStorage();
        const cache = await RasterCache.open(storage, 'cache', undefined, 0);
        await cache.put('hash', 1, dataUrlOf([1, 2]));

        await storage.remove('cache/hash-1.png');

        expect(await cache.get('hash', 1)).toBeNull();
        expect(cache.entryCount).toBe(0);
        expect(cache.totalCachedBytes).toBe(0);
    });

    it('starts empty if the persisted index is corrupted', async () => {
        const storage = makeStorage();
        await storage.mkdir('cache');
        await storage.writeBinary('cache/index.json', new TextEncoder().encode('{not json').buffer);

        const cache = await RasterCache.open(storage, 'cache');
        expect(cache.entryCount).toBe(0);
        expect(await cache.get('hash', 1)).toBeNull();
    });

    it('clear() empties the cache (both tiers) and removes blobs from storage', async () => {
        const storage = makeStorage();
        const cache = await RasterCache.open(storage, 'cache');
        await cache.put('hash', 1, dataUrlOf([1]));
        await cache.put('hash', 2, dataUrlOf([2]));

        await cache.clear();

        expect(cache.entryCount).toBe(0);
        expect(cache.totalCachedBytes).toBe(0);
        expect(cache.memoryEntryCount).toBe(0);
        expect(cache.memoryCachedBytes).toBe(0);
        expect(await cache.get('hash', 1)).toBeNull();
        expect(storage.files.has('cache/hash-1.png')).toBe(false);
        expect(storage.files.has('cache/hash-2.png')).toBe(false);
    });

    it('memory tier avoids re-reading disk on repeated gets', async () => {
        const storage = makeStorage();
        const cache1 = await RasterCache.open(storage, 'cache');
        await cache1.put('hash', 1, dataUrlOf([1, 2, 3]));

        // Fresh instance sharing the same storage — its own memory tier
        // starts empty even though the disk index already has the entry.
        const cache2 = await RasterCache.open(storage, 'cache');
        const readSpy = vi.spyOn(storage, 'readBinary');

        expect(await cache2.get('hash', 1)).toBe(dataUrlOf([1, 2, 3])); // disk hit, populates memory tier
        expect(await cache2.get('hash', 1)).toBe(dataUrlOf([1, 2, 3])); // served from memory tier
        expect(readSpy).toHaveBeenCalledTimes(1);
    });

    it('memory tier evicts on its own, independent (smaller) budget', async () => {
        // Disk budget generous (1000 bytes); memory budget tiny (8 bytes).
        const cache = await RasterCache.open(makeStorage(), 'cache', 1000, 8);
        await cache.put('hash', 1, dataUrlOf([0, 0, 0, 0])); // 4 bytes
        await cache.put('hash', 2, dataUrlOf([0, 0, 0, 0])); // memory total 8
        await cache.put('hash', 3, dataUrlOf([0, 0, 0, 0])); // memory total 12 > 8 -> evict page 1 from memory only

        expect(cache.entryCount).toBe(3); // disk tier unaffected, well under its own budget
        expect(cache.memoryCachedBytes).toBeLessThanOrEqual(8);
        expect(cache.memoryEntryCount).toBeLessThanOrEqual(2);
    });

    it('re-exports hashBytes as a deterministic content hash', () => {
        const a = hashBytes(new Uint8Array([1, 2, 3]));
        const b = hashBytes(new Uint8Array([1, 2, 3]));
        const c = hashBytes(new Uint8Array([1, 2, 4]));
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });
});
