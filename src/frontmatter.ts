// Builds the optional YAML front matter block for generated markdown files.
// Front matter becomes Obsidian "properties" — searchable via the syntax at
// https://obsidian.md/help/plugins/search#Search+properties (e.g.
// `["device": A5X2]`) and usable in Dataview/Bases queries — so a vault with
// many imported Supernote notes can filter/sort on them instead of relying
// on full-text search alone. See issue #57.
export interface NoteFrontmatterData {
    /** Link back to the source .note/.spd file, already formatted by
     *  `app.fileManager.generateMarkdownLink()` (wikilink or `[text](path)`,
     *  following the vault's own link-format setting). */
    sourceLink: string;
    /** Device model that captured the note (SupernoteX header's
     *  APPLY_EQUIPMENT, e.g. "A5X2"). Omitted from the block when empty or
     *  '0' (the device's own "unset" sentinel). */
    device: string;
    /** Total page count. */
    pageCount: number;
    /** Deduplicated keywords — the device's own "star" keywords — across
     *  every page, in first-seen order. Omitted from the block when empty. */
    keywords: string[];
}

// Double-quoted YAML scalars use (almost) the same escaping rules as JSON
// strings, so JSON.stringify is a safe, dependency-free way to quote
// arbitrary text (colons, quotes, `#`, leading `[[`, etc.) for a YAML value.
function yamlScalar(value: string): string {
    return JSON.stringify(value);
}

function yamlStringList(values: string[]): string {
    return values.map(v => `  - ${yamlScalar(v)}`).join('\n');
}

export function buildFrontmatter(data: NoteFrontmatterData): string {
    const lines: string[] = ['---', 'tags:', '  - supernote'];

    lines.push(`source: ${yamlScalar(data.sourceLink)}`);

    if (data.device !== '' && data.device !== '0') {
        lines.push(`device: ${yamlScalar(data.device)}`);
    }

    lines.push(`pages: ${data.pageCount}`);

    if (data.keywords.length > 0) {
        lines.push('keywords:', yamlStringList(data.keywords));
    }

    lines.push('---', '');
    return lines.join('\n');
}
