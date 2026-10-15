import { App, TFile } from 'obsidian';
import { SyncEngineId, SyncRunResult } from './syncAbstraction';

const CLOUD_LOG_CATEGORIES = new Set([
    'Missing Cloud checksum',
    'Cloud download descriptor checksum does not match inventory',
    'Cloud download request failed',
    'Cloud download failed size or checksum validation',
    'Cloud download exceeds size limit',
    'Cloud transfer or vault write failed',
    'Cloud mirror Trash or vault operation failed',
    'Cloud inventory changed; deletion skipped',
    'Cloud deletion inventory incomplete; deletion skipped',
    'Cloud mirror folder cleanup failed',
]);

export function syncLogPath(syncFolder: string): string {
    const cleanRoot = syncFolder.replace(/^\/+|\/+$/g, '');
    return cleanRoot ? `${cleanRoot}/Sync Log.md` : 'Sync Log.md';
}

function renderLogEntry(engineId: SyncEngineId, now: Date, lines: string[]): string {
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const engine = engineId === 'ip-device' ? 'Direct IP connection' : 'Supernote Cloud';
    return `## ${timestamp} (${engine})\n${lines.map((line) => `- ${line}`).join('\n')}\n\n`;
}

export function formatSyncLogEntry(result: SyncRunResult, now: Date = new Date()): string | null {
    const protectedIssues = result.issues.filter((issue) => issue.kind === 'protected');
    const failures = result.issues.filter((issue) => issue.kind === 'failure');
    const warnings = result.issues.filter((issue) => issue.kind === 'warning');
    if (!protectedIssues.length && !failures.length && !warnings.length && !result.removed && !result.removedFolders) return null;

    if (result.engineId === 'supernote-cloud') {
        const lines = [
            `${result.synced} downloaded, ${result.unchanged} unchanged, ${result.excluded} out of scope, ${result.removed} files moved to Trash, ${result.removedFolders ?? 0} folders moved to Trash`,
            `${protectedIssues.length} skipped (locally edited), ${failures.length} failed, ${warnings.length} warnings`,
            ...protectedIssues.map((issue) => `Skipped (edited locally since last sync): \`${issue.item}\``),
            ...failures.map((issue) => {
                const category = CLOUD_LOG_CATEGORIES.has(issue.message) ? issue.message : 'Cloud sync failure';
                return issue.item ? `Failed: \`${issue.item}\` — ${category}` : `Failed: ${category}`;
            }),
            ...warnings.map((issue) => `Warning: ${CLOUD_LOG_CATEGORIES.has(issue.message) ? issue.message : 'Cloud sync warning'}`),
        ];
        return renderLogEntry(result.engineId, now, lines);
    }
    return renderLogEntry(result.engineId, now, [
        ...protectedIssues.map((issue) => `Skipped (edited locally since last sync): \`${issue.item}\``),
        ...failures.map((issue) => `Failed: \`${issue.item}\` — ${issue.message}`),
        ...warnings.map((issue) => `Warning: ${issue.message}`),
    ]);
}

export function formatSyncFailureLogEntry(engineId: SyncEngineId, message: string, now: Date = new Date()): string {
    const category = engineId === 'ip-device' ? message : 'Cloud sync failed';
    return renderLogEntry(engineId, now, [`Sync failed: ${category}`]);
}

async function ensureSyncLogFile(app: App, syncFolder: string): Promise<TFile> {
    const logPath = syncLogPath(syncFolder);
    const parent = logPath.includes('/') ? logPath.slice(0, logPath.lastIndexOf('/')) : '';
    let current = '';
    for (const segment of parent.split('/').filter(Boolean)) {
        current = current ? `${current}/${segment}` : segment;
        if (!app.vault.getAbstractFileByPath(current)) {
            try {
                await app.vault.createFolder(current);
            } catch {
                if (!app.vault.getAbstractFileByPath(current)) throw new Error('Could not create sync log folder');
            }
        }
    }
    const existing = app.vault.getAbstractFileByPath(logPath);
    if (existing instanceof TFile) return existing;
    if (existing) throw new Error('Sync log path is not a file');
    return app.vault.create(logPath, '');
}

export async function reportSyncResult(app: App, syncFolder: string, result: SyncRunResult): Promise<void> {
    const entry = formatSyncLogEntry(result);
    if (entry) await app.vault.append(await ensureSyncLogFile(app, syncFolder), entry);
    else if (result.engineId === 'ip-device') await ensureSyncLogFile(app, syncFolder);
}

export async function reportSyncFailure(app: App, syncFolder: string, engineId: SyncEngineId, error: unknown): Promise<void> {
    const message = engineId === 'ip-device' ? (error instanceof Error ? error.message : String(error)) : '';
    await app.vault.append(await ensureSyncLogFile(app, syncFolder), formatSyncFailureLogEntry(engineId, message));
}