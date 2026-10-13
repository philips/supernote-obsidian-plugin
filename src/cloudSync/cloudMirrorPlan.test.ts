import { describe, expect, it } from 'vitest';
import { DEFAULT_FILE_EXTENSION_ALLOWLIST } from '../syncFilters';
import { CloudInventoryItem } from './cloudInventory';
import { planCloudMirror, VerifiedCloudFile } from './cloudMirrorPlan';

function file(path: string, id: string, md5: string | null = '0123456789abcdef0123456789abcdef'): VerifiedCloudFile {
    const fileName = path.split('/').at(-1)!;
    const item: CloudInventoryItem = {
        id, directoryId: '0', fileName, isFolder: false, size: '10', md5,
        depth: 1, parentDerivedPath: `/unverified/${fileName}`, parentPath: '/unverified',
    };
    return { item, canonicalPath: path };
}

describe('Cloud mirror planning boundary', () => {
    it('uses verified paths and shared hash ownership when classifying inventory', () => {
        const files = [
            file('/Note/Changed.note', '1', '11111111111111111111111111111111'),
            file('/Note/Kept.note', '2'),
            file('/Note/Edited.spd', '3', '11111111111111111111111111111111'),
            file('/Note/Missing.note', '4'),
            file('/Note/Out.txt', '5'),
        ];
        const manifest = {
            'Mirror/Note/Changed.note': { contentHash: 'ours', cloudMd5: 'old' },
            'Mirror/Note/Kept.note': { contentHash: 'ours', cloudMd5: '0123456789abcdef0123456789abcdef' },
            'Mirror/Note/Edited.spd': { contentHash: 'ours', cloudMd5: 'old' },
            'Mirror/Note/Missing.note': { contentHash: 'ours', cloudMd5: '0123456789abcdef0123456789abcdef' },
        };
        const localHashes = {
            'Mirror/Note/Changed.note': 'ours',
            'Mirror/Note/Kept.note': 'ours',
            'Mirror/Note/Edited.spd': 'local-edit',
        };

        const result = planCloudMirror(files, 'Mirror', manifest, localHashes, [], DEFAULT_FILE_EXTENSION_ALLOWLIST);

        expect(result.toDownload.map(({ vaultPath }) => vaultPath))
            .toEqual(['Mirror/Note/Changed.note', 'Mirror/Note/Missing.note']);
        expect(result.unchanged.map(({ item }) => item.id)).toEqual(['2']);
        expect(result.protected.map(({ item }) => item.id)).toEqual(['3']);
        expect(result.excluded.map(({ item }) => item.id)).toEqual(['5']);
        expect(result.missingChecksum).toEqual([]);
    });

    it('honors path and extension filters without deleting previously mirrored files', () => {
        const files = [file('/Note/Work/Kept.note', '1'), file('/Note/Personal/Other.note', '2'),
            file('/Note/Work/Out.txt', '3')];
        const result = planCloudMirror(files, 'Mirror', {}, {}, ['/Note/Work/*'], DEFAULT_FILE_EXTENSION_ALLOWLIST);

        expect(result.toDownload.map(({ item }) => item.id)).toEqual(['1']);
        expect(result.excluded.map(({ item }) => item.id)).toEqual(['2', '3']);
        expect(result).not.toHaveProperty('toDelete');
    });

    it('downloads to re-baseline IP-origin records and blocks files without checksums', () => {
        const files = [file('/Note/IP.note', '1'), file('/Note/NoHash.note', '2', null)];
        const result = planCloudMirror(files, 'Mirror', {
            'Mirror/Note/IP.note': { contentHash: 'ours' },
        }, { 'Mirror/Note/IP.note': 'ours' }, [], DEFAULT_FILE_EXTENSION_ALLOWLIST);

        expect(result.toDownload.map(({ item }) => item.id)).toEqual(['1']);
        expect(result.missingChecksum.map(({ item }) => item.id)).toEqual(['2']);
    });

    it('rejects unsafe verified paths and duplicate destinations', () => {
        const plan = (files: VerifiedCloudFile[]) => planCloudMirror(
            files, 'Mirror', {}, {}, [], DEFAULT_FILE_EXTENSION_ALLOWLIST,
        );
        expect(() => plan([file('/Note/../escape.note', '1')])).toThrow('Unsafe verified Cloud path');
        expect(() => plan([file('/Note/Same.note', '1'), file('/Note/Same.note', '2')]))
            .toThrow('colliding paths');
    });
});