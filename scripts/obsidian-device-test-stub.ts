// Minimal Node-only Obsidian shim for scripts/test-device-sync.entry.ts.
// It is only used by esbuild's integration-test bundle; the plugin itself
// continues to import Obsidian's real API.

export class App {}

export class TFile {
    path: string;

    constructor(path: string) {
        this.path = path;
    }
}

export class SuggestModal<T> {
    constructor(..._args: unknown[]) {}
    open(): void {}
    close(): void {}
    setPlaceholder(_placeholder: string): void {}
    setInstructions(_instructions: unknown[]): void {}
}

export class Modal {
    contentEl = { empty: () => undefined };
    constructor(..._args: unknown[]) {}
    open(): void {}
    close(): void {}
}

export class Notice {
    constructor(..._args: unknown[]) {}
}

export class MarkdownView {}
export class PluginSettingTab {
    containerEl = { empty: () => undefined };
    constructor(..._args: unknown[]) {}
}
export class Setting {
    constructor(..._args: unknown[]) {}
}
export class ExtraButtonComponent {
    constructor(..._args: unknown[]) {}
}

export function setIcon(..._args: unknown[]): void {}

interface RequestUrlParam {
    url: string;
    method?: string;
    body?: string | ArrayBuffer;
    contentType?: string;
    headers?: Record<string, string>;
}

export async function requestUrl(param: RequestUrlParam): Promise<{
    status: number;
    text: string;
    arrayBuffer: ArrayBuffer;
}> {
    const headers = new Headers(param.headers);
    if (param.contentType) headers.set('content-type', param.contentType);
    const response = await fetch(param.url, {
        method: param.method,
        headers,
        body: param.body,
    });
    const [text, arrayBuffer] = await Promise.all([
        response.clone().text(),
        response.arrayBuffer(),
    ]);
    return { status: response.status, text, arrayBuffer };
}
