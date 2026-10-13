import { describe, expect, it } from 'vitest';
import { CloudControlPlaneTransport, CloudJsonObject, CloudRawResponse } from './cloudProtocol';
import {
    collectCloudInventory,
    listCloudDirectory,
    parseCloudDirectoryPage,
    queryCloudPath,
    verifyCloudInventoryPaths,
} from './cloudInventory';
import { CLOUD_ROUTES } from './cloudPolicy';

class FakeTransport implements CloudControlPlaneTransport {
    readonly requests: CloudJsonObject[] = [];

    constructor(private readonly responses: CloudRawResponse[]) {}

    async bootstrapCsrf(): Promise<void> {}

    async post(
        route: string,
        body: CloudJsonObject,
        options?: { accessToken?: string },
    ): Promise<CloudRawResponse> {
        expect(route).toBe(CLOUD_ROUTES.directoryList);
        expect(options?.accessToken).toBe('session-token');
        this.requests.push(body);
        const response = this.responses.shift();
        if (!response) throw new Error('Unexpected directory-list request');
        return response;
    }
}

function directoryResponse(pageNumber: number, ids: string[]): CloudRawResponse {
    const entries = ids.map((id, index) => ({
        id,
        directoryId: '9223372036854775807',
        fileName: `Synthetic ${((pageNumber - 1) * 100) + index + 1}.note`,
        size: 12,
        md5: '0123456789abcdef0123456789abcdef',
        isFolder: 'N',
    }));
    return {
        status: 200,
        body: JSON.stringify({
            success: true,
            total: 101,
            pages: 2,
            pageNum: pageNumber,
            pageSize: 100,
            userFileVOList: entries,
        }).replaceAll('"9223372036854775807"', '9223372036854775807'),
    };
}

describe('Cloud inventory pagination', () => {
    it('verifies queried hierarchy while reconciling standard root category casing', () => {
        const items = [
            { id: '10', directoryId: '0', fileName: 'Note', isFolder: true, depth: 1, parentPath: '/', parentDerivedPath: '/Note', size: null, md5: null },
            { id: '20', directoryId: '10', fileName: 'MM', isFolder: true, depth: 2, parentPath: '/Note', parentDerivedPath: '/Note/MM', size: null, md5: null },
            { id: '30', directoryId: '20', fileName: 'Sample.note', isFolder: false, depth: 3, parentPath: '/Note/MM', parentDerivedPath: '/Note/MM/Sample.note', size: null, md5: null },
        ];
        const inventory = { directories: [], items };
        const queried = new Map([
            ['10', { path: 'NOTE/', idPath: '1/10/' }],
            ['20', { path: 'NOTE/MM/', idPath: '1/10/20/' }],
            ['30', { path: 'NOTE/MM/Sample.note/', idPath: '1/10/20/30/' }],
        ]);
        expect([...verifyCloudInventoryPaths(inventory, queried)]).toEqual([
            ['10', '/Note'], ['20', '/Note/MM'], ['30', '/Note/MM/Sample.note'],
        ]);
        expect(() => verifyCloudInventoryPaths(inventory, new Map([
            ...queried, ['30', { path: 'OTHER/MM/Sample.note/', idPath: '1/10/20/30/' }],
        ]))).toThrow('does not extend its listed parent');
        expect(() => verifyCloudInventoryPaths(inventory, new Map([
            ...queried, ['10', { path: 'OTHER/', idPath: '1/10/' }],
        ]))).toThrow('does not match its listed name');
        expect(() => verifyCloudInventoryPaths(inventory, new Map([
            ...queried, ['30', { path: 'NOTE/MM/Sample.note/', idPath: '1/10/99/30/' }],
        ]))).toThrow('does not extend its listed parent');
        const collidingItem = { ...items[2], id: '31' };
        expect(() => verifyCloudInventoryPaths({ directories: [], items: [...items, collidingItem] }, new Map([
            ...queried, ['31', { path: 'NOTE/MM/Sample.note/', idPath: '1/10/20/31/' }],
        ]))).toThrow('colliding paths');
    });

    it('keeps literal percent and plus signs while normalizing Unicode in distinct parent folders', () => {
        const fileName = 'Cafe\u0301%+.note';
        const roots = ['Note', 'Document'].map((name, index) => ({
            id: String(index + 1), directoryId: '0', fileName: name, isFolder: true,
            depth: 1, parentPath: '/', parentDerivedPath: `/${name}`, size: null, md5: null,
        }));
        const files = roots.map((root, index) => ({
            id: String(index + 3), directoryId: root.id, fileName, isFolder: false,
            depth: 2, parentPath: root.parentDerivedPath,
            parentDerivedPath: `${root.parentDerivedPath}/${fileName}`, size: null, md5: null,
        }));
        const queries = new Map([
            ['1', { path: 'NOTE/', idPath: '10/1/' }],
            ['2', { path: 'DOCUMENT/', idPath: '10/2/' }],
            ['3', { path: `NOTE/${fileName}/`, idPath: '10/1/3/' }],
            ['4', { path: `DOCUMENT/${fileName}/`, idPath: '10/2/4/' }],
        ]);
        const canonical = verifyCloudInventoryPaths({ directories: [], items: [...roots, ...files] }, queries);
        expect(canonical.get('3')).toBe('/Note/Caf\u00e9%+.note');
        expect(canonical.get('4')).toBe('/Document/Caf\u00e9%+.note');
        expect(() => verifyCloudInventoryPaths({ directories: [], items: [...roots, ...files] }, new Map([
            ...queries, ['3', { path: 'NOTE/other/', idPath: '10/1/3/' }],
        ]))).toThrow('does not match its listed name');
    });

    it('accepts the observed pages/size envelope when pageNum and pageSize are absent', async () => {
        const toHostedResponse = (response: CloudRawResponse): CloudRawResponse => {
            const body = JSON.parse(response.body) as Record<string, unknown>;
            body.size = body.pageSize;
            delete body.pageSize;
            delete body.pageNum;
            return { status: response.status, body: JSON.stringify(body) };
        };
        const ids = Array.from({ length: 100 }, (_, index) => String(9223372036854775000n + BigInt(index)));
        const transport = new FakeTransport([
            toHostedResponse(directoryResponse(1, ids)),
            toHostedResponse(directoryResponse(2, ['9223372036854775900'])),
        ]);
        await expect(listCloudDirectory(transport, 'session-token', '9223372036854775807'))
            .resolves.toHaveLength(101);
        expect(transport.requests.map((request) => request.pageNo)).toEqual([1, 2]);
    });

    it('reports only the type of an invalid pageNum without echoing response data', () => {
        const response = {
            status: 200,
            body: '{"success":true,"pageNum":"not-a-number","secret":"private-value"}',
        };
        expect(() => parseCloudDirectoryPage(response, 1, 100))
            .toThrow('invalid pageNum field (type: string)');
        try {
            parseCloudDirectoryPage(response, 1, 100);
        } catch (error) {
            expect(String(error)).not.toContain('private-value');
            expect(String(error)).not.toContain('not-a-number');
        }
    });

    it('lists a real second page without rounding int64 identifiers', async () => {
        const firstPageIds = Array.from({ length: 100 }, (_, index) => String(9223372036854775000n + BigInt(index)));
        const finalId = '9223372036854775900';
        const transport = new FakeTransport([
            directoryResponse(1, firstPageIds),
            directoryResponse(2, [finalId]),
        ]);

        const entries = await listCloudDirectory(transport, 'session-token', '9223372036854775807');

        expect(entries).toHaveLength(101);
        expect(entries[0].id).toBe(firstPageIds[0]);
        expect(entries.at(-1)?.id).toBe(finalId);
        expect(entries[0].directoryId).toBe('9223372036854775807');
        expect(transport.requests).toEqual([
            {
                directoryId: '9223372036854775807',
                order: 'filename',
                sequence: 'asc',
                pageNo: 1,
                pageSize: 100,
            },
            {
                directoryId: '9223372036854775807',
                order: 'filename',
                sequence: 'asc',
                pageNo: 2,
                pageSize: 100,
            },
        ]);
    });

    it('fails closed on unexpected pagination and duplicate IDs', async () => {
        const wrongPage = directoryResponse(2, ['9223372036854775900']);
        expect(() => parseCloudDirectoryPage(wrongPage, 1, 100)).toThrow('unexpected directory page number');

        const duplicateId = '9223372036854775000';
        const duplicateTransport = new FakeTransport([
            directoryResponse(1, Array.from({ length: 100 }, () => duplicateId)),
        ]);
        await expect(listCloudDirectory(duplicateTransport, 'session-token', '0'))
            .rejects.toThrow('duplicate item ID');
    });

    it('reports aggregate counts without exposing file metadata on inconsistent totals', async () => {
        const response = directoryResponse(1, ['9223372036854775900']);
        const body = JSON.parse(response.body) as Record<string, unknown>;
        body.total = 2;
        body.pages = 1;
        response.body = JSON.stringify(body);
        await expect(listCloudDirectory(new FakeTransport([response]), 'session-token', '9223372036854775807'))
            .rejects.toThrow('entries: 1, files: 1, folders: 0, total: 2, pages: 1');
    });

    it('accepts only the observed six-folder root total exception', async () => {
        const names = ['Note', 'Document', 'Screenshot', 'Export', 'Inbox', 'Mystyle'];
        const entries = names.map((fileName, index) => ({
            id: index + 1,
            directoryId: 0,
            fileName,
            isFolder: 'Y',
        }));
        const response = (items: typeof entries) => ({
            status: 200,
            body: JSON.stringify({ success: true, total: 5, pages: 1, size: 100, userFileVOList: items }),
        });

        await expect(listCloudDirectory(new FakeTransport([response(entries)]), 'session-token', '0'))
            .resolves.toHaveLength(6);
        await expect(listCloudDirectory(new FakeTransport([response(entries)]), 'session-token', '1'))
            .rejects.toThrow('total is inconsistent');
        await expect(listCloudDirectory(new FakeTransport([response(entries.map((entry, index) =>
            index === 5 ? { ...entry, fileName: 'Other' } : entry))]), 'session-token', '0'))
            .rejects.toThrow('total is inconsistent');
    });

    it('permits flattened parents only for the observed root listing', async () => {
        const names = ['Note', 'Document', 'Screenshot', 'Export', 'Inbox', 'Mystyle'];
        const rootEntries = names.map((fileName, index) => ({
            id: index + 1,
            directoryId: index < 3 ? 0 : 99,
            fileName,
            isFolder: 'Y',
        }));
        const response = (total: number, entries: object[]) => ({
            status: 200,
            body: JSON.stringify({ success: true, total, pages: total ? 1 : 0, size: 100, userFileVOList: entries }),
        });
        const root = response(5, rootEntries);
        const emptyChildren = names.map(() => response(0, []));
        const responses = [root, ...emptyChildren];
        const transport: CloudControlPlaneTransport = {
            async bootstrapCsrf() {},
            async post() {
                const next = responses.shift();
                if (!next) throw new Error('Missing listing');
                return next;
            },
        };
        const inventory = await collectCloudInventory(transport, 'session-token');
        expect(inventory.directories[0]).toMatchObject({ id: '0', total: 5 });
        expect(inventory.directories).toHaveLength(7);
        expect(inventory.items.filter((item) => item.directoryId === '99' && item.parentPath === '/'))
            .toHaveLength(3);

        const child = response(1, [{ id: 7, directoryId: 99, fileName: 'Synthetic.note', isFolder: 'N' }]);
        const childResponses = [root, child];
        await expect(collectCloudInventory({
            async bootstrapCsrf() {},
            async post() {
                const next = childResponses.shift();
                if (!next) throw new Error('Missing listing');
                return next;
            },
        }, 'session-token')).rejects.toThrow('unexpected parent ID');
    });

    it('accepts nonempty short pages when the final accumulated total is exact', async () => {
        const firstPage = directoryResponse(1, Array.from(
            { length: 99 },
            (_, index) => String(9223372036854775000n + BigInt(index)),
        ));
        const secondPage = directoryResponse(2, ['9223372036854775900', '9223372036854775901']);
        const transport = new FakeTransport([firstPage, secondPage]);

        await expect(listCloudDirectory(transport, 'session-token', '9223372036854775807'))
            .resolves.toHaveLength(101);
    });

    it('recursively traverses folders and parses path-query results', async () => {
        const requests: Array<{ route: string; body: CloudJsonObject }> = [];
        const transport: CloudControlPlaneTransport = {
            async bootstrapCsrf() {},
            async post(route, body, options) {
                expect(options?.accessToken).toBe('session-token');
                requests.push({ route, body });
                if (route === CLOUD_ROUTES.pathQuery) {
                    return {
                        status: 200,
                        body: '{"success":true,"path":"/Note/Work/","idPath":"/10/20/"}',
                    };
                }
                if (body.directoryId === '0') {
                    return {
                        status: 200,
                        body: '{"success":true,"total":1,"pages":1,"pageNum":1,"pageSize":100,"userFileVOList":[{"id":10,"directoryId":0,"fileName":"Note","isFolder":"Y"}]}',
                    };
                }
                return {
                    status: 200,
                    body: '{"success":true,"total":1,"pages":1,"pageNum":1,"pageSize":100,"userFileVOList":[{"id":20,"directoryId":10,"fileName":"Caf\u00e9.note","size":12,"md5":"0123456789abcdef0123456789abcdef","isFolder":"N"}]}',
                };
            },
        };

        const inventory = await collectCloudInventory(transport, 'session-token');
        const path = await queryCloudPath(transport, 'session-token', '20');

        expect(inventory.directories).toEqual([
            { id: '0', path: '/', pageCount: 1, total: 1 },
            { id: '10', path: '/Note', pageCount: 1, total: 1 },
        ]);
        expect(inventory.items.map((item) => item.parentDerivedPath)).toEqual(['/Note', '/Note/Café.note']);
        expect(path).toEqual({ path: '/Note/Work/', idPath: '/10/20/' });
        expect(requests.at(-1)).toEqual({ route: CLOUD_ROUTES.pathQuery, body: { id: '20' } });
    });
});