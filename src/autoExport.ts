// Frontmatter keys written into auto-exported markdown files, used to find a
// `.note` file's companion `.md` again later and to decide whether it needs
// regenerating. See decideAction() for how these get used.
export const FM_SOURCE_PATH = 'supernote-source-path';
export const FM_SOURCE_DIGEST = 'supernote-source-digest';
export const FM_SOURCE_IMAGES = 'supernote-source-images';
export const FM_OVERWRITE = 'supernote-overwrite';

export interface AutoExportFrontmatter {
    [FM_SOURCE_PATH]?: string;
    [FM_SOURCE_DIGEST]?: string;
    [FM_SOURCE_IMAGES]?: string[];
    [FM_OVERWRITE]?: boolean;
}

// sha1 is plenty here - this is a change-detection fingerprint, not a
// security boundary - and matches the "sha1-..." format philips proposed in
// https://github.com/philips/supernote-obsidian-plugin/issues/41.
export async function computeDigest(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `sha1-${hex}`;
}

// Folder scope check: `notePath` is in scope if it sits inside (at any depth)
// one of `watchFolders`. Folder paths are matched by exact segment, not
// substring, so a folder "Notes" doesn't accidentally match "Notes Archive".
// An empty watch list means nothing is in scope - auto-export is opt-in per
// folder, not vault-wide by default.
export function isPathInScope(notePath: string, watchFolders: string[]): boolean {
    for (const folder of watchFolders) {
        const normalized = folder.replace(/^\/+|\/+$/g, '');
        if (normalized.length === 0) continue; // vault root as a watch folder would match everything; require an explicit folder
        if (notePath === normalized || notePath.startsWith(`${normalized}/`)) {
            return true;
        }
    }
    return false;
}

export type AutoExportAction =
    | { type: 'create' }
    | { type: 'regenerate'; staleImages: string[] }
    | { type: 'noop' }
    | { type: 'skip-user-edited' }
    | { type: 'skip-foreign-file' };

// Decides what auto-export should do with a `.note` file given whatever
// already exists at its deterministic target `.md` path.
//
// - `existingFrontmatter` is null when no file exists at the target path yet.
// - `hasSupernoteFrontmatter` distinguishes "no file there" from "a file is
//   there but it's not one we generated" (e.g. an unrelated user note that
//   happens to share the same basename) - never overwrite the latter.
export function decideAction(
    existingFrontmatter: AutoExportFrontmatter | null,
    hasSupernoteFrontmatter: boolean,
    newDigest: string,
): AutoExportAction {
    if (existingFrontmatter === null) {
        return { type: 'create' };
    }
    if (!hasSupernoteFrontmatter) {
        return { type: 'skip-foreign-file' };
    }
    if (existingFrontmatter[FM_SOURCE_DIGEST] === newDigest) {
        return { type: 'noop' };
    }
    if (existingFrontmatter[FM_OVERWRITE] === false) {
        return { type: 'skip-user-edited' };
    }
    return { type: 'regenerate', staleImages: existingFrontmatter[FM_SOURCE_IMAGES] ?? [] };
}
