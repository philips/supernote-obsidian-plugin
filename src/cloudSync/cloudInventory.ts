import {
    CloudControlPlaneTransport,
    CloudJsonObject,
    CloudProtocolError,
    CloudRawResponse,
    parseCloudObject,
    requireCanonicalDecimalId,
    requireCloudSuccess,
    requireNonEmptyString,
    requireSafeInteger,
} from './cloudProtocol';
import {
    CLOUD_LIST_PAGE_SIZE,
    CLOUD_MAX_DIRECTORY_DEPTH,
    CLOUD_MAX_INVENTORY_ITEMS,
    CLOUD_MAX_PAGES_PER_DIRECTORY,
    CLOUD_ROUTES,
} from './cloudPolicy';

export interface CloudDirectoryEntry {
    id: string;
    directoryId: string;
    fileName: string;
    isFolder: boolean;
    size: string | null;
    md5: string | null;
}

export interface CloudDirectoryPage {
    pageNumber: number;
    pageCount: number;
    pageSize: number;
    total: number;
    entries: CloudDirectoryEntry[];
}

export interface CloudInventoryItem extends CloudDirectoryEntry {
    depth: number;
    parentDerivedPath: string;
    parentPath: string;
}

export interface CloudInventoryDirectory {
    id: string;
    path: string;
    pageCount: number;
    total: number;
}

export interface CloudInventoryPass {
    directories: CloudInventoryDirectory[];
    items: CloudInventoryItem[];
}

export interface CloudPathResult {
    path: string;
    idPath: string;
}

export async function listCloudDirectory(
    transport: CloudControlPlaneTransport,
    accessToken: string,
    directoryId: string,
): Promise<CloudDirectoryEntry[]> {
    return (await readCloudDirectory(transport, accessToken, directoryId)).entries;
}

export async function collectCloudInventory(
    transport: CloudControlPlaneTransport,
    accessToken: string,
): Promise<CloudInventoryPass> {
    const directories: CloudInventoryDirectory[] = [];
    const items: CloudInventoryItem[] = [];
    const itemIds = new Set<string>();
    const queuedDirectoryIds = new Set<string>(['0']);
    const queue: Array<{ id: string; path: string; depth: number }> = [{ id: '0', path: '/', depth: 0 }];

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const directory = queue[queueIndex];
        const listing = await readCloudDirectory(transport, accessToken, directory.id);
        directories.push({
            id: directory.id,
            path: directory.path,
            pageCount: listing.pageCount,
            total: listing.total,
        });

        for (const entry of listing.entries) {
            if (entry.directoryId !== directory.id) {
                throw new CloudProtocolError('Supernote Cloud directory item has an unexpected parent ID');
            }
            if (itemIds.has(entry.id)) {
                throw new CloudProtocolError('Supernote Cloud inventory contains a duplicate item ID');
            }
            itemIds.add(entry.id);
            if (items.length >= CLOUD_MAX_INVENTORY_ITEMS) {
                throw new CloudProtocolError(`Supernote Cloud inventory exceeded ${CLOUD_MAX_INVENTORY_ITEMS} items`);
            }

            const path = appendCloudPath(directory.path, entry.fileName);
            const item: CloudInventoryItem = {
                ...entry,
                depth: directory.depth + 1,
                parentDerivedPath: path,
                parentPath: directory.path,
            };
            items.push(item);

            if (entry.isFolder) {
                if (item.depth > CLOUD_MAX_DIRECTORY_DEPTH) {
                    throw new CloudProtocolError(`Supernote Cloud inventory exceeded depth ${CLOUD_MAX_DIRECTORY_DEPTH}`);
                }
                if (queuedDirectoryIds.has(entry.id)) {
                    throw new CloudProtocolError('Supernote Cloud inventory contains a directory cycle');
                }
                queuedDirectoryIds.add(entry.id);
                queue.push({ id: entry.id, path, depth: item.depth });
            }
        }
    }

    return { directories, items };
}

export async function queryCloudPath(
    transport: CloudControlPlaneTransport,
    accessToken: string,
    id: string,
): Promise<CloudPathResult> {
    const parsed = parseCloudObject(await transport.post(
        CLOUD_ROUTES.pathQuery,
        { id },
        { accessToken },
    ));
    requireCloudSuccess(parsed);
    return {
        path: requireNonEmptyString(parsed, 'path'),
        idPath: requireNonEmptyString(parsed, 'idPath'),
    };
}

async function readCloudDirectory(
    transport: CloudControlPlaneTransport,
    accessToken: string,
    directoryId: string,
): Promise<{ entries: CloudDirectoryEntry[]; pageCount: number; total: number }> {
    const entries: CloudDirectoryEntry[] = [];
    const ids = new Set<string>();
    let expectedTotal: number | null = null;
    let expectedPageCount: number | null = null;

    for (let pageNumber = 1; pageNumber <= CLOUD_MAX_PAGES_PER_DIRECTORY; pageNumber++) {
        const response = await transport.post(CLOUD_ROUTES.directoryList, {
            directoryId,
            order: 'filename',
            sequence: 'asc',
            pageNo: pageNumber,
            pageSize: CLOUD_LIST_PAGE_SIZE,
        }, { accessToken });
        const page = parseCloudDirectoryPage(response, pageNumber, CLOUD_LIST_PAGE_SIZE);

        expectedTotal ??= page.total;
        expectedPageCount ??= page.pageCount;
        if (page.total !== expectedTotal || page.pageCount !== expectedPageCount) {
            throw new CloudProtocolError('Supernote Cloud directory pagination changed during listing');
        }
        for (const entry of page.entries) {
            if (ids.has(entry.id)) {
                throw new CloudProtocolError('Supernote Cloud directory listing contains a duplicate item ID');
            }
            ids.add(entry.id);
            entries.push(entry);
        }

        if (pageNumber === page.pageCount || (page.pageCount === 0 && pageNumber === 1)) {
            if (entries.length !== page.total) {
                throw new CloudProtocolError('Supernote Cloud directory listing total is inconsistent');
            }
            return { entries, pageCount: page.pageCount, total: page.total };
        }
    }

    throw new CloudProtocolError(`Supernote Cloud directory exceeded ${CLOUD_MAX_PAGES_PER_DIRECTORY} pages`);
}

export function parseCloudDirectoryPage(
    response: CloudRawResponse,
    expectedPageNumber: number,
    expectedPageSize: number,
): CloudDirectoryPage {
    const parsed = parseCloudObject(response);
    requireCloudSuccess(parsed);

    const pageNumber = requireSafeInteger(parsed, 'pageNum');
    const pageCount = requireSafeInteger(parsed, 'pages');
    const pageSize = requireSafeInteger(parsed, 'pageSize');
    const total = requireSafeInteger(parsed, 'total');
    if (pageNumber !== expectedPageNumber) {
        throw new CloudProtocolError('Supernote Cloud returned an unexpected directory page number');
    }
    if (pageSize !== expectedPageSize) {
        throw new CloudProtocolError('Supernote Cloud returned an unexpected directory page size');
    }
    if (pageCount > CLOUD_MAX_PAGES_PER_DIRECTORY) {
        throw new CloudProtocolError('Supernote Cloud directory page count exceeds the safety limit');
    }
    const emptyPageCountIsValid = total === 0 && (pageCount === 0 || pageCount === 1) && pageNumber === 1;
    const nonEmptyPageCountIsValid = total > 0
        && pageCount === Math.ceil(total / pageSize)
        && pageNumber <= pageCount;
    if (!emptyPageCountIsValid && !nonEmptyPageCountIsValid) {
        throw new CloudProtocolError('Supernote Cloud returned inconsistent directory pagination');
    }

    const rawEntries = parsed.userFileVOList;
    if (!Array.isArray(rawEntries)) {
        throw new CloudProtocolError('Supernote Cloud response has an invalid userFileVOList field');
    }
    if (rawEntries.length > pageSize || (total === 0 ? rawEntries.length !== 0 : rawEntries.length === 0)) {
        throw new CloudProtocolError('Supernote Cloud directory page length is inconsistent');
    }

    return {
        pageNumber,
        pageCount,
        pageSize,
        total,
        entries: rawEntries.map((entry, index) => parseCloudDirectoryEntry(entry, index)),
    };
}

function parseCloudDirectoryEntry(value: unknown, index: number): CloudDirectoryEntry {
    if (!isCloudJsonObject(value)) {
        throw new CloudProtocolError(`Supernote Cloud directory item ${index + 1} is invalid`);
    }
    const folderValue = value.isFolder;
    if (folderValue !== 'Y' && folderValue !== 'N') {
        throw new CloudProtocolError(`Supernote Cloud directory item ${index + 1} has an invalid isFolder field`);
    }

    return {
        id: requireCanonicalDecimalId(value, 'id'),
        directoryId: requireCanonicalDecimalId(value, 'directoryId'),
        fileName: requireNonEmptyString(value, 'fileName'),
        isFolder: folderValue === 'Y',
        size: optionalCanonicalDecimal(value, 'size'),
        md5: optionalString(value, 'md5'),
    };
}

function optionalCanonicalDecimal(value: CloudJsonObject, field: string): string | null {
    if (value[field] === undefined || value[field] === null) return null;
    return requireCanonicalDecimalId(value, field);
}

function optionalString(value: CloudJsonObject, field: string): string | null {
    const fieldValue = value[field];
    if (fieldValue === undefined || fieldValue === null) return null;
    if (typeof fieldValue !== 'string') {
        throw new CloudProtocolError(`Supernote Cloud response has an invalid ${field} field`);
    }
    return fieldValue;
}

function isCloudJsonObject(value: unknown): value is CloudJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendCloudPath(parentPath: string, fileName: string): string {
    const hasControlCharacters = [...fileName].some((character) => {
        const characterCode = character.charCodeAt(0);
        return characterCode <= 31 || characterCode === 127;
    });
    if (
        fileName === '.'
        || fileName === '..'
        || fileName.includes('/')
        || fileName.includes('\\')
        || hasControlCharacters
    ) {
        throw new CloudProtocolError('Supernote Cloud returned an unsafe file name');
    }
    return `${parentPath === '/' ? '' : parentPath}/${fileName.normalize('NFC')}`;
}