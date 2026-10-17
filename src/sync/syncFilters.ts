// Translates a small glob subset into an anchored RegExp: `*` matches within
// one path segment, `**` crosses directory boundaries, and `?` matches one
// character. The syntax is deliberately small and shared by every sync
// engine rather than tied to a transport's path encoding.
export function globToRegExp(pattern: string): RegExp {
    let expression = '';
    for (let index = 0; index < pattern.length; index++) {
        const character = pattern[index];
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                expression += '.*';
                index++;
            } else {
                expression += '[^/]*';
            }
        } else if (character === '?') {
            expression += '[^/]';
        } else if ('.+^${}()|[]\\'.includes(character)) {
            expression += `\\${character}`;
        } else {
            expression += character;
        }
    }
    return new RegExp(`^${expression}$`);
}

export function matchesAnyPathPattern(pathVariants: readonly string[], patterns: readonly string[]): boolean {
    if (patterns.length === 0) return true;
    return patterns.some((pattern) => {
        const expression = globToRegExp(pattern);
        return pathVariants.some((path) => expression.test(path));
    });
}

export function parsePathFilters(raw: string): string[] {
    return raw
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
}

export interface FileExtensionAllowlist {
    allowAll: boolean;
    extensions: readonly string[];
}

export const DEFAULT_FILE_EXTENSION_ALLOWLIST: FileExtensionAllowlist = {
    allowAll: false,
    extensions: ['.note', '.spd'],
};

export const ALL_FILE_EXTENSIONS: FileExtensionAllowlist = {
    allowAll: true,
    extensions: [],
};

export function parseFileExtensionAllowlist(raw: string): FileExtensionAllowlist {
    const entries = raw
        .split(/[\n,]+/)
        .map((value) => value.trim().toLocaleLowerCase())
        .filter((value) => value.length > 0);

    if (entries.includes('*')) return ALL_FILE_EXTENSIONS;

    return {
        allowAll: false,
        extensions: [...new Set(entries.map((entry) => entry.startsWith('.') ? entry : `.${entry}`))],
    };
}

export function validateFileExtensionAllowlist(raw: string): string | void {
    const entries = raw
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    const invalid = entries.find((entry) => entry !== '*'
        && (entry === '.' || entry.includes('/') || entry.includes('\\') || entry.includes('*')));
    if (invalid) {
        return `Invalid file extension: ${invalid}`;
    }
}

export function matchesFileExtension(fileName: string, allowlist: FileExtensionAllowlist): boolean {
    if (allowlist.allowAll) return true;
    const normalizedName = fileName.toLocaleLowerCase();
    return allowlist.extensions.some((extension) => normalizedName.endsWith(extension));
}