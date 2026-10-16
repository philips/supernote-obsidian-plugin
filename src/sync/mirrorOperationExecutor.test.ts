import { describe, expect, it, vi } from 'vitest';
import { hashBytes } from './directIP/deviceSync';
import { MirrorOperationExecutor, MirrorRecoveryAttentionError, recoverMirrorOperation } from './mirrorOperationExecutor';
import { loadMirrorManifest, MirrorManifestSlot, saveMirrorManifest } from './sharedMirrorManifestStore';
import { RootMirrorManifestService } from './sharedMirrorManifestStore';

const path = 'Mirror/Note/Test.note';
const before = new TextEncoder().encode('old');
const after = new TextEncoder().encode('new');
const record = { contentHash: hashBytes(after), source: { engineId: 'ip-device' as const,
    deviceUri: '/Test.note', deviceDate: '2026-10-16', deviceSize: 3 } };

function harness() {
    const slots = new Map<MirrorManifestSlot, string>();
    const files = new Map<string, Uint8Array>();
    const storage = {
        read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
        write: async (slot: MirrorManifestSlot, contents: string) => { slots.set(slot, contents); },
    };
    const service = new RootMirrorManifestService(() => storage);
    const read = async (target: string) => files.get(target) ?? null;
    return { service, files, read, load: () => loadMirrorManifest(storage, {}),
        seed: async () => saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: null,
            records: { [path]: { ...record, contentHash: hashBytes(before) } } }) };
}

describe('ordinary mirror operation recovery', () => {
    it('commits intent before writing and clears it with the new record', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        fixture.files.set(path, before);
        const write = vi.fn(async (target: string, bytes: Uint8Array) => {
            expect((await fixture.load()).manifest.pendingOperation?.beforeHash).toBe(hashBytes(before));
            fixture.files.set(target, bytes);
        });
        await new MirrorOperationExecutor(fixture.service, 'Mirror', loaded, fixture.read)
            .write(path, after, record, write);
        expect(write).toHaveBeenCalledOnce();
        expect((await fixture.load()).manifest.pendingOperation).toBeUndefined();
        expect((await fixture.load()).manifest.records[path]).toEqual(record);
    });

    it('recovers the new bytes after a failed manifest completion on restart', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        fixture.files.set(path, before);
        const originalCommit = fixture.service.commit.bind(fixture.service);
        let commits = 0;
        fixture.service.commit = async (previous, manifest) => {
            if (++commits === 2) throw new Error('interrupted');
            return originalCommit(previous, manifest);
        };
        await expect(new MirrorOperationExecutor(fixture.service, 'Mirror', loaded, fixture.read)
            .write(path, after, record, async (target, bytes) => { fixture.files.set(target, bytes); }))
            .rejects.toThrow('interrupted');
        fixture.service.commit = originalCommit;
        await recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read);
        expect((await fixture.load()).manifest.records[path]).toEqual(record);
        expect((await fixture.load()).manifest.pendingOperation).toBeUndefined();
    });

    it('does not overwrite bytes edited while intent is being committed', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        fixture.files.set(path, before);
        const originalCommit = fixture.service.commit.bind(fixture.service);
        fixture.service.commit = async (previous, manifest) => {
            const committed = await originalCommit(previous, manifest);
            if (manifest.pendingOperation) fixture.files.set(path, new TextEncoder().encode('edited'));
            return committed;
        };
        const write = vi.fn(async () => {});
        await expect(new MirrorOperationExecutor(fixture.service, 'Mirror', loaded, fixture.read)
            .write(path, after, record, write)).rejects.toThrow('changed after intent commit');
        expect(write).not.toHaveBeenCalled();
        expect((await fixture.load()).manifest.pendingOperation?.path).toBe(path);
    });

    it('keeps unexpected bytes and uncertain Trash pending without mutation', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        const pending = { kind: 'write' as const, root: 'Mirror', path,
            beforeHash: hashBytes(before), after: record };
        await fixture.service.commit(loaded, { ...loaded.manifest, pendingOperation: pending });
        fixture.files.set(path, new TextEncoder().encode('edited'));
        await expect(recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read))
            .rejects.toBeInstanceOf(MirrorRecoveryAttentionError);
        expect((await fixture.load()).manifest.pendingOperation).toEqual(pending);
        const current = await fixture.load();
        await fixture.service.commit(current, { ...current.manifest,
            pendingOperation: { ...pending, kind: 'trash', after: null } });
        fixture.files.set(path, before);
        await expect(recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read))
            .rejects.toThrow('Trash outcome is uncertain');
    });

    it('reports attention when a proved state cannot be committed', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        await fixture.service.commit(loaded, { ...loaded.manifest,
            pendingOperation: { kind: 'write', root: 'Mirror', path,
                beforeHash: hashBytes(before), after: record } });
        fixture.files.set(path, after);
        fixture.service.commit = async () => { throw new Error('storage unavailable'); };
        await expect(recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read))
            .rejects.toBeInstanceOf(MirrorRecoveryAttentionError);
        expect((await fixture.load()).manifest.pendingOperation?.path).toBe(path);
    });

    it('requires a fresh complete source check for missing files', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        await fixture.service.commit(loaded, { ...loaded.manifest,
            pendingOperation: { kind: 'write', root: 'Mirror', path, beforeHash: null, after: record } });
        await expect(recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read))
            .rejects.toThrow('manual sync');
        await expect(recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read,
            async () => { throw new Error('incomplete inventory'); })).rejects.toThrow('unavailable or incomplete');
        await recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read,
            async () => 'present');
        expect((await fixture.load()).manifest.pendingOperation).toBeUndefined();
        expect((await fixture.load()).manifest.records[path]).toBeUndefined();
    });

    it('retires a record only when the missing source is confirmed absent', async () => {
        const fixture = harness();
        const loaded = await fixture.seed();
        await fixture.service.commit(loaded, { ...loaded.manifest,
            pendingOperation: { kind: 'trash', root: 'Mirror', path,
                beforeHash: hashBytes(before), after: null } });
        await recoverMirrorOperation(fixture.service, await fixture.load(), 'Mirror', fixture.read,
            async () => 'absent');
        expect((await fixture.load()).manifest.records[path]).toBeUndefined();
    });
});