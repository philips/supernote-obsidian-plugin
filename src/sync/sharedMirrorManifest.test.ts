import { describe, expect, it } from 'vitest';
import { buildSyncRecord } from './directIP/deviceSync';
import {
    cloudAccountFingerprint,
    cloudPlanningRecords,
    fromIpSyncManifest,
    mergeIpSyncManifest,
    MIRROR_METADATA_DIRECTORY,
    toIpSyncManifest,
} from './sharedMirrorManifest';

describe('shared mirror manifest', () => {
    it('derives a stable versioned account fingerprint without exposing the raw ID', () => {
        expect(cloudAccountFingerprint('123')).toMatch(/^v1:[a-f0-9]{64}$/);
        expect(cloudAccountFingerprint('123')).toBe(cloudAccountFingerprint('123'));
        expect(cloudAccountFingerprint('123')).not.toBe(cloudAccountFingerprint('124'));
        expect(() => cloudAccountFingerprint('01')).toThrow('Invalid Cloud account identity');
    });
    it('preserves IP history by destination without fabricating Cloud checksums', () => {
        const record = buildSyncRecord({ uri: '/Note/Sample.note', date: '2026-10-13', size: 4 },
            'Mirror/Note/Sample.note', 'written-hash');
        const manifest = fromIpSyncManifest({ [record.deviceUri]: record });

        expect(manifest).toEqual({
            version: 1,
            cloudAccountFingerprint: null,
            records: {
                'Mirror/Note/Sample.note': {
                    contentHash: 'written-hash',
                    source: { engineId: 'ip-device', deviceUri: '/Note/Sample.note',
                        deviceDate: '2026-10-13', deviceSize: 4 },
                },
            },
        });
        expect(cloudPlanningRecords(manifest)['Mirror/Note/Sample.note'])
            .toEqual({ contentHash: 'written-hash', cloudMd5: undefined });
        expect(toIpSyncManifest(manifest)['/Note/Sample.note']).toMatchObject({
            deviceDate: '2026-10-13', deviceSize: 4, vaultPath: 'Mirror/Note/Sample.note',
            contentHash: 'written-hash',
        });
        expect(MIRROR_METADATA_DIRECTORY).toBe('.supernote-sync');
    });

    it('merges successful IP updates while retaining Cloud binding and unrelated Cloud records', () => {
        const ipRecord = buildSyncRecord({ uri: '/Note/Sample.note', date: 'today', size: 4 },
            'Mirror/Note/Sample.note', 'ip-hash');
        const manifest = {
            version: 1 as const,
            cloudAccountFingerprint: 'v1:synthetic',
            records: {
                'Mirror/Note/Sample.note': {
                    contentHash: 'cloud-hash',
                    source: { engineId: 'supernote-cloud' as const, md5: '0'.repeat(32) },
                },
                'Mirror/Cloud.note': {
                    contentHash: 'cloud-only',
                    source: { engineId: 'supernote-cloud' as const, md5: '1'.repeat(32) },
                },
            },
        };

        const merged = mergeIpSyncManifest(manifest, { [ipRecord.deviceUri]: ipRecord });

        expect(merged.cloudAccountFingerprint).toBe('v1:synthetic');
        expect(merged.records['Mirror/Note/Sample.note']).toMatchObject({
            contentHash: 'ip-hash', source: { engineId: 'ip-device', deviceUri: '/Note/Sample.note' },
        });
        expect(merged.records['Mirror/Cloud.note']).toEqual(manifest.records['Mirror/Cloud.note']);
    });

    it('refuses to merge two IP sources into one destination', () => {
        const first = buildSyncRecord({ uri: '/First.note', date: 'today', size: 1 }, 'Mirror/Same.note', 'hash');
        const second = buildSyncRecord({ uri: '/Second.note', date: 'today', size: 1 }, 'Mirror/Same.note', 'hash');
        expect(() => fromIpSyncManifest({ [first.deviceUri]: first, [second.deviceUri]: second }))
            .toThrow('duplicate mirror destinations');
    });
});