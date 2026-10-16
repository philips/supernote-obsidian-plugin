import { describe, expect, it } from 'vitest';
import { buildSyncRecord } from './directIP/deviceSync';
import { MirrorManifestSlot, loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';

function storage() {
    const slots = new Map<MirrorManifestSlot, string>();
    return {
        slots,
        read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
        write: async (slot: MirrorManifestSlot, contents: string) => { slots.set(slot, contents); },
    };
}

describe('shared mirror manifest persistence', () => {
    it('migrates IP history once, retaining legacy settings and refusing competing writes', async () => {
        const store = storage();
        const record = buildSyncRecord({ uri: '/Page.note', date: 'today', size: 3 }, 'Mirror/Page.note', 'hash');
        const legacy = { [record.deviceUri]: record };
        const first = await loadMirrorManifest(store, legacy);
        expect(first.manifest.records['Mirror/Page.note'].source).toMatchObject({ engineId: 'ip-device' });
        expect(legacy[record.deviceUri]).toBe(record);
        expect(await loadMirrorManifest(store, {})).toEqual(first);
        const updated = { ...first.manifest, cloudAccountFingerprint: 'v1:synthetic' };
        const second = await saveMirrorManifest(store, first, updated);
        expect(second.slot).toBe('backup');
        await expect(saveMirrorManifest(store, first, updated)).rejects.toThrow('changed since it was loaded');
        await expect(saveMirrorManifest(store, { ...second, manifest: first.manifest }, updated))
            .rejects.toThrow('changed since it was loaded');
    });

    it('adds non-conflicting legacy IP history without replacing shared records or Cloud binding', async () => {
        const store = storage();
        const current = await loadMirrorManifest(store, {});
        const cloudRecord = {
            contentHash: 'cloud-hash',
            source: { engineId: 'supernote-cloud' as const, md5: '0123456789abcdef0123456789abcdef' },
        };
        const bound = await saveMirrorManifest(store, current, {
            ...current.manifest,
            cloudAccountFingerprint: 'v1:synthetic',
            records: { 'Mirror/shared.note': cloudRecord },
        });
        const legacyRecord = buildSyncRecord({ uri: '/Legacy.note', date: 'today', size: 3 },
            'Mirror/legacy.note', 'ip-hash');

        const migrated = await loadMirrorManifest(store, {
            [legacyRecord.deviceUri]: legacyRecord,
            '/Collision.note': buildSyncRecord({ uri: '/Collision.note', date: 'today', size: 4 },
                'Mirror/shared.note', 'legacy-hash'),
        });

        expect(migrated.manifest.cloudAccountFingerprint).toBe('v1:synthetic');
        expect(migrated.manifest.records['Mirror/shared.note']).toEqual(cloudRecord);
        expect(migrated.manifest.records['Mirror/legacy.note'].source).toMatchObject({ engineId: 'ip-device' });
        expect(migrated.revision).toBe(bound.revision + 1);
    });

    it('does not migrate legacy history during pending Cloud account recovery', async () => {
        const store = storage();
        const pending = {
            version: 1 as const, cloudAccountFingerprint: 'v1:synthetic', records: {},
            accountChange: { targetFingerprint: `v1:${'a'.repeat(64)}`, pendingPath: null, protectedPaths: [] },
        };
        const saved = await saveMirrorManifest(store, null, pending);
        const legacy = buildSyncRecord({ uri: '/Legacy.note', date: 'today', size: 3 }, 'Mirror/Legacy.note', 'hash');

        expect(await loadMirrorManifest(store, { [legacy.deviceUri]: legacy })).toEqual(saved);
        expect(await loadMirrorManifest(store, {})).toEqual(saved);
    });

    it('recovers the last valid revision when a later slot write is torn', async () => {
        const store = storage();
        const first = await loadMirrorManifest(store, {});
        store.slots.set('backup', '{"revision":2,"manifest":');
        expect(await loadMirrorManifest(store, {})).toEqual(first);
        const repaired = await saveMirrorManifest(store, first, first.manifest);
        expect(repaired.revision).toBe(2);
        expect(await loadMirrorManifest(store, {})).toEqual(repaired);
    });

    it('fails closed when all stored copies are corrupt or legacy destinations collide', async () => {
        const store = storage();
        store.slots.set('primary', '{invalid');
        await expect(loadMirrorManifest(store, {})).rejects.toThrow('neither copy is valid');
        const one = buildSyncRecord({ uri: '/One.note', date: 'today', size: 1 }, 'Mirror/Same.note', 'a');
        const two = buildSyncRecord({ uri: '/Two.note', date: 'today', size: 1 }, 'Mirror/Same.note', 'b');
        await expect(loadMirrorManifest(storage(), { [one.deviceUri]: one, [two.deviceUri]: two }))
            .rejects.toThrow('duplicate mirror destinations');
    });

    it('rejects invalid records even when the stored checksum is consistent', async () => {
        const store = storage();
        const first = await loadMirrorManifest(store, {});
        await expect(saveMirrorManifest(store, first, {
            ...first.manifest, records: { '../outside.note': {
                contentHash: 'hash', source: { engineId: 'supernote-cloud', md5: '0123456789abcdef0123456789abcdef' },
            } },
        })).rejects.toThrow('Invalid shared mirror manifest');
        expect(await loadMirrorManifest(store, {})).toEqual(first);
    });

    it('does not redo migration after an interrupted first write', async () => {
        const store = storage();
        store.write = async (slot) => { store.slots.set(slot, '{incomplete'); };
        await expect(loadMirrorManifest(store, {})).rejects.toThrow('write could not be verified');
        await expect(loadMirrorManifest(store, {})).rejects.toThrow('neither copy is valid');
    });

    it('refuses legacy records inside the reserved metadata directory', async () => {
        const store = storage();
        const record = buildSyncRecord({ uri: '/history.note', date: 'today', size: 1 },
            'Mirror/.supernote-sync/history.note', 'hash');
        await expect(loadMirrorManifest(store, { [record.deviceUri]: record }))
            .rejects.toThrow('Invalid shared mirror manifest');
        expect(store.slots.size).toBe(0);
    });

    it('rejects unsafe legacy destination characters before persisting', async () => {
        const store = storage();
        const record = buildSyncRecord({ uri: '/file.note', date: 'today', size: 1 },
            'Mirror/unsafe\\file.note', 'hash');
        await expect(loadMirrorManifest(store, { [record.deviceUri]: record }))
            .rejects.toThrow('Invalid shared mirror manifest');
        expect(store.slots.size).toBe(0);
    });
});