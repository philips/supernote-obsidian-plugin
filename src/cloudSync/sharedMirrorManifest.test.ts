import { describe, expect, it } from 'vitest';
import { buildSyncRecord } from '../deviceSync';
import { cloudPlanningRecords, fromIpSyncManifest, MIRROR_METADATA_DIRECTORY } from './sharedMirrorManifest';

describe('shared mirror manifest', () => {
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
        expect(MIRROR_METADATA_DIRECTORY).toBe('.supernote-sync');
    });

    it('refuses to merge two IP sources into one destination', () => {
        const first = buildSyncRecord({ uri: '/First.note', date: 'today', size: 1 }, 'Mirror/Same.note', 'hash');
        const second = buildSyncRecord({ uri: '/Second.note', date: 'today', size: 1 }, 'Mirror/Same.note', 'hash');
        expect(() => fromIpSyncManifest({ [first.deviceUri]: first, [second.deviceUri]: second }))
            .toThrow('duplicate mirror destinations');
    });
});