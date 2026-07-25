// Wraps `fetch` requests to the Supernote's local "Browse and Access" HTTP
// server so every call site (listing, download, upload) times out and fails
// with the same clear message instead of hanging until the OS's TCP timeout
// (which can take a minute or more on an unreachable device and, to the
// user, looks indistinguishable from the plugin just doing nothing).
export const DEVICE_REQUEST_TIMEOUT_MS = 3000;

export async function fetchFromDevice(
    ip: string,
    path: string,
    context: string,
    init: RequestInit = {},
): Promise<Response> {
    try {
        return await fetch(`http://${ip}:8089${path}`, {
            ...init,
            signal: AbortSignal.timeout(DEVICE_REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') {
            throw new Error(
                `${context}: Supernote at ${ip} did not respond within ${DEVICE_REQUEST_TIMEOUT_MS / 1000}s. `
                + `Check that it's on the same network and "Browse and Access" is turned on.`
            );
        }
        throw new Error(
            `${context}: could not reach Supernote at ${ip} (${err instanceof Error ? err.message : String(err)}).`
        );
    }
}
