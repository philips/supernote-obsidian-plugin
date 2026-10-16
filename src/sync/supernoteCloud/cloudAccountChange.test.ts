import { describe, expect, it, vi } from 'vitest';
import { hashBytes } from '../directIP/deviceSync';
import { parseFileExtensionAllowlist } from '../syncFilters';
import { changeCloudMirrorAccount } from './cloudAccountChange';
import { CloudMirrorVault } from './cloudMirrorWrite';
import { SharedMirrorManifest } from '../sharedMirrorManifest';
import { loadMirrorManifest, MirrorManifestStorage, saveMirrorManifest } from '../sharedMirrorManifestStore';

const bytes = new TextEncoder().encode('original');
const edited = new TextEncoder().encode('edited');
const oldFingerprint = `v1:${'a'.repeat(64)}`;
const newFingerprint = `v1:${'b'.repeat(64)}`;

function fixture() {
    const slots = new Map<string, string>();
    const storage: MirrorManifestStorage = {
        read: async (slot) => slots.get(slot) ?? null,
        write: async (slot, contents) => { slots.set(slot, contents); },
    };
    const files = new Map([
        ['Mirror/Note/clean.note', bytes], ['Mirror/Note/edited.note', edited],
        ['Mirror/Note/excluded.pdf', bytes], ['Mirror/Note/ip.note', bytes],
    ]);
    const trash = vi.fn(async (path: string) => { files.delete(path); });
    const vault: CloudMirrorVault = { read: async (path) => files.get(path) ?? null,
        write: async () => {}, trash };
    const manifest: SharedMirrorManifest = { version: 1, cloudAccountFingerprint: oldFingerprint, records: {
        'Mirror/Note/clean.note': { contentHash: hashBytes(bytes), source: { engineId: 'supernote-cloud', md5: 'a'.repeat(32) } },
        'Mirror/Note/edited.note': { contentHash: hashBytes(bytes), source: { engineId: 'supernote-cloud', md5: 'a'.repeat(32) } },
        'Mirror/Note/excluded.pdf': { contentHash: hashBytes(bytes), source: { engineId: 'supernote-cloud', md5: 'a'.repeat(32) } },
        'Mirror/Note/ip.note': { contentHash: hashBytes(bytes), source: {
            engineId: 'ip-device', deviceUri: '/Note/ip.note', deviceDate: '2026-01-01', deviceSize: bytes.length,
        } },
    } };
    const run = async () => changeCloudMirrorAccount(storage, await loadMirrorManifest(storage, {}), vault,
        newFingerprint, 'Mirror', [], parseFileExtensionAllowlist('.note'));
    return { storage, files, trash, vault, manifest, run };
}

describe('Cloud account change', () => {
    it('trashes only unchanged in-scope Cloud files and retains IP and local files', async () => {
        const { storage, files, trash, manifest, run } = fixture();
        await saveMirrorManifest(storage, null, manifest);
        expect(await run()).toEqual({ protectedPaths: ['Mirror/Note/edited.note', 'Mirror/Note/excluded.pdf'] });
        expect(trash).toHaveBeenCalledTimes(1);
        expect(trash).toHaveBeenCalledWith('Mirror/Note/clean.note');
        expect([...files.keys()]).toEqual(['Mirror/Note/edited.note', 'Mirror/Note/excluded.pdf', 'Mirror/Note/ip.note']);
        expect((await loadMirrorManifest(storage, {})).manifest).toEqual({ version: 1, cloudAccountFingerprint: newFingerprint,
            records: { 'Mirror/Note/ip.note': manifest.records['Mirror/Note/ip.note'] } });
    });

    it('recovers after Trash succeeds but manifest commit fails', async () => {
        const { storage, files, manifest, run, trash } = fixture();
        await saveMirrorManifest(storage, null, manifest);
        const originalWrite = storage.write.bind(storage);
        let interrupted = false;
        storage.write = async (slot, contents) => {
            if (!interrupted && trash.mock.calls.length === 1) {
                interrupted = true;
                throw new Error('interrupted');
            }
            await originalWrite(slot, contents);
        };
        await expect(run()).rejects.toThrow('interrupted');
        expect(files.has('Mirror/Note/clean.note')).toBe(false);
        expect((await loadMirrorManifest(storage, {})).manifest.accountChange?.pendingPath).toBe('Mirror/Note/clean.note');
        expect(await run()).toEqual({ protectedPaths: ['Mirror/Note/edited.note', 'Mirror/Note/excluded.pdf'] });
        expect(trash).toHaveBeenCalledTimes(1);
    });

    it('recovers a pending file that was edited before Trash', async () => {
        const { storage, manifest, files, run, trash } = fixture();
        await saveMirrorManifest(storage, null, { ...manifest, accountChange: {
            targetFingerprint: newFingerprint, pendingPath: 'Mirror/Note/clean.note', protectedPaths: [],
        } });
        files.set('Mirror/Note/clean.note', edited);
        expect((await run()).protectedPaths).toContain('Mirror/Note/clean.note');
        expect(files.get('Mirror/Note/clean.note')).toEqual(edited);
        expect(trash).not.toHaveBeenCalledWith('Mirror/Note/clean.note');
    });

    it('rejects an unbound manifest with IP records without touching vault files', async () => {
        const { storage, manifest, run, trash } = fixture();
        await saveMirrorManifest(storage, null, { ...manifest, cloudAccountFingerprint: null,
            records: { 'Mirror/Note/ip.note': manifest.records['Mirror/Note/ip.note'] } });
        await expect(run()).rejects.toThrow('no account binding');
        expect(trash).not.toHaveBeenCalled();
        expect(Object.keys((await loadMirrorManifest(storage, {})).manifest.records)).toEqual(['Mirror/Note/ip.note']);
    });

    it('never trashes a shared Sync Log even if legacy history marks it as Cloud-managed', async () => {
        const { storage, manifest, files, trash, run } = fixture();
        files.set('Mirror/Sync Log.md', bytes);
        await saveMirrorManifest(storage, null, { ...manifest, records: {
            ...manifest.records, 'Mirror/Sync Log.md': { contentHash: hashBytes(bytes),
                source: { engineId: 'supernote-cloud', md5: 'a'.repeat(32) } },
        } });
        const result = await run();
        expect(result.protectedPaths).toContain('Mirror/Sync Log.md');
        expect(files.has('Mirror/Sync Log.md')).toBe(true);
        expect(trash).not.toHaveBeenCalledWith('Mirror/Sync Log.md');
    });

    it('refuses another target or records outside the sync root before Trash', async () => {
        const { storage, manifest, run, trash } = fixture();
        await saveMirrorManifest(storage, null, { ...manifest,
            accountChange: { targetFingerprint: `v1:${'c'.repeat(64)}`, pendingPath: null, protectedPaths: [] } });
        await expect(run()).rejects.toThrow('already in progress');
        expect(trash).not.toHaveBeenCalled();
    });
});