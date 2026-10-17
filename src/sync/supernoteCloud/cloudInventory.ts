import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
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

// Parent-derived paths are useful for traversal and diagnostics, but are not
// treated as canonical Cloud paths: production's flattened folder presentation
// leaves that relationship unresolved until each file's path query is checked.
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

export function cloudInventoryFingerprint(
    inventory: CloudInventoryPass,
    canonicalPathsById: Readonly<Record<string, string>>,
): string {
    if (Object.keys(canonicalPathsById).length !== inventory.items.length) {
        throw new CloudProtocolError('Cloud inventory fingerprint requires all verified paths');
    }
    const entries = inventory.items.map((item) => {
        const path = canonicalPathsById[item.id];
        if (!path) throw new CloudProtocolError('Cloud inventory fingerprint is missing a verified path');
        return [item.id, item.directoryId, path, item.isFolder, item.md5] as const;
    }).sort((left, right) => left[0].localeCompare(right[0]));
    return bytesToHex(sha256(utf8ToBytes(JSON.stringify(entries))));
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
    // Return only after every queued directory and page has validated. Callers
    // must never infer remote deletion from a partially completed traversal.
    const directories: CloudInventoryDirectory[] = [];
    const items: CloudInventoryItem[] = [];
    const itemIds = new Set<string>();
    const queuedDirectoryIds = new Set<string>(['0']);
    const queue: Array<{ id: string; path: string; depth: number }> = [{ id: '0', path: '/', depth: 0 }];

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const directory = queue[queueIndex];
        const listing = await readCloudDirectory(transport, accessToken, directory.id);
        const flattenedRoot = isObservedFlattenedRoot(directory.id, listing);
        directories.push({
            id: directory.id,
            path: directory.path,
            pageCount: listing.pageCount,
            total: listing.total,
        });

        for (const entry of listing.entries) {
            if (entry.directoryId !== directory.id && !flattenedRoot) {
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

export function verifyCloudInventoryPaths(
    inventory: CloudInventoryPass,
    queriedPaths: ReadonlyMap<string, CloudPathResult>,
): Map<string, string> {
    if (queriedPaths.size !== inventory.items.length) {
        throw new CloudProtocolError('Supernote Cloud path queries did not cover the inventory');
    }
    const rootCategories = new Set(['Note', 'Document', 'Screenshot', 'Export', 'Inbox', 'Mystyle']);
    const foldersByPath = new Map(inventory.items.filter((item) => item.isFolder)
        .map((item) => [item.parentDerivedPath, item]));
    const canonicalPaths = new Map<string, string>();
    const uniquePaths = new Set<string>();
    const uniqueIdPaths = new Set<string>();

    for (const item of inventory.items) {
        const query = queriedPaths.get(item.id);
        if (!query) throw new CloudProtocolError('Supernote Cloud item is missing a path query');
        const pathSegments = parseQueriedSegments(query.path);
        const idSegments = parseQueriedSegments(query.idPath);
        if (!idSegments.every((segment) => /^(0|[1-9]\d*)$/.test(segment)) || idSegments.at(-1) !== item.id) {
            throw new CloudProtocolError('Supernote Cloud item has an inconsistent ID path');
        }
        const fileName = item.fileName.normalize('NFC');
        if (pathSegments.at(-1) !== fileName) {
            const rootCategory = item.depth === 1 && item.isFolder && rootCategories.has(item.fileName);
            if (!rootCategory || pathSegments.length !== 1 || pathSegments[0].toLowerCase() !== fileName.toLowerCase()) {
                throw new CloudProtocolError('Supernote Cloud item path does not match its listed name');
            }
        }

        let canonicalPath: string;
        if (item.depth === 1) {
            if (pathSegments.length !== 1) throw new CloudProtocolError('Supernote Cloud root path is inconsistent');
            canonicalPath = `/${fileName}`;
        } else {
            const parent = foldersByPath.get(item.parentPath);
            const parentQuery = parent && queriedPaths.get(parent.id);
            const verifiedParent = parent && canonicalPaths.get(parent.id);
            if (!parentQuery || !verifiedParent) throw new CloudProtocolError('Supernote Cloud path parent is missing');
            const parentSegments = parseQueriedSegments(parentQuery.path);
            const parentIdSegments = parseQueriedSegments(parentQuery.idPath);
            if (pathSegments.length !== parentSegments.length + 1
                || pathSegments.slice(0, -1).some((segment, index) => segment !== parentSegments[index])
                || idSegments.length !== parentIdSegments.length + 1
                || idSegments.slice(0, -1).some((segment, index) => segment !== parentIdSegments[index])) {
                throw new CloudProtocolError('Supernote Cloud path does not extend its listed parent');
            }
            canonicalPath = `${verifiedParent}/${fileName}`;
        }
        if (uniquePaths.has(canonicalPath) || uniqueIdPaths.has(query.idPath)) {
            throw new CloudProtocolError('Supernote Cloud inventory contains colliding paths');
        }
        uniquePaths.add(canonicalPath);
        uniqueIdPaths.add(query.idPath);
        canonicalPaths.set(item.id, canonicalPath);
    }
    return canonicalPaths;
}

function parseQueriedSegments(path: string): string[] {
    if (path.startsWith('/') || !path.endsWith('/')) {
        throw new CloudProtocolError('Supernote Cloud returned an unexpected path form');
    }
    const segments = path.slice(0, -1).split('/').map((segment) => segment.normalize('NFC'));
    if (segments.some((segment) => !segment || segment === '.' || segment === '..'
        || segment.includes('\\') || [...segment].some((character) => character.charCodeAt(0) < 32))) {
        throw new CloudProtocolError('Supernote Cloud returned an unsafe path segment');
    }
    return segments;
}

async function readCloudDirectory(
    transport: CloudControlPlaneTransport,
    accessToken: string,
    directoryId: string,
): Promise<{ entries: CloudDirectoryEntry[]; pageCount: number; total: number }> {
    // Listings are treated as live queries, not snapshots. Repeated IDs or a
    // changing total/page count make the pass incomplete rather than selecting
    // whichever page happened to arrive last.
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
            // On October 13, 2026, the hosted root listed all six standard
            // folders with total=5; each child reported an exact item total.
            // Limit this exception to that observed root shape.
            const observedRootException = isObservedFlattenedRoot(directoryId, {
                entries, pageCount: page.pageCount, total: page.total,
            });
            if (entries.length !== page.total && !observedRootException) {
                const folderCount = entries.filter((entry) => entry.isFolder).length;
                throw new CloudProtocolError(
                    `Supernote Cloud directory listing total is inconsistent (entries: ${entries.length}, files: ${entries.length - folderCount}, folders: ${folderCount}, total: ${page.total}, pages: ${page.pageCount})`,
                );
            }
            return { entries, pageCount: page.pageCount, total: page.total };
        }
    }

    throw new CloudProtocolError(`Supernote Cloud directory exceeded ${CLOUD_MAX_PAGES_PER_DIRECTORY} pages`);
}

function isObservedFlattenedRoot(
    directoryId: string,
    listing: { entries: CloudDirectoryEntry[]; pageCount: number; total: number },
): boolean {
    if (directoryId !== '0' || listing.pageCount !== 1 || listing.total !== 5 || listing.entries.length !== 6) {
        return false;
    }
    const names = new Set(['Note', 'Document', 'Screenshot', 'Export', 'Inbox', 'Mystyle']);
    return listing.entries.every((entry) => entry.isFolder && names.delete(entry.fileName)) && names.size === 0;
}

export function parseCloudDirectoryPage(
    response: CloudRawResponse,
    expectedPageNumber: number,
    expectedPageSize: number,
): CloudDirectoryPage {
    const parsed = parseCloudObject(response);
    requireCloudSuccess(parsed);

    // The October 13, 2026 hosted listing omitted pageNum/pageSize but returned
    // pages/size/total. Use the requested page only when no pageNum is supplied;
    // the complete item count and duplicate-ID checks still gate the traversal.
    const pageNumber = parsed.pageNum === undefined ? expectedPageNumber : requireSafeInteger(parsed, 'pageNum');
    const pageCount = requireSafeInteger(parsed, 'pages');
    const pageSize = requireSafeInteger(parsed, parsed.pageSize === undefined ? 'size' : 'pageSize');
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
    // Reject separators before joining: decoding or normalizing an unsafe name
    // later could turn one remote leaf into a vault path outside its parent.
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