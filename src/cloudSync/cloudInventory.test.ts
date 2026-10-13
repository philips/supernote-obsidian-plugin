import { describe, expect, it } from 'vitest';
import { CloudControlPlaneTransport, CloudJsonObject, CloudRawResponse } from './cloudProtocol';
import {
    collectCloudInventory,
    listCloudDirectory,
    parseCloudDirectoryPage,
    queryCloudPath,
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