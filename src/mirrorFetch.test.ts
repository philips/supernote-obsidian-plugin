import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { fetchMirrorFrameViaRange, MIRROR_RANGE_BYTES, MIRROR_TIMEOUT_MS } from './mirrorFetch';

vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
}));

vi.mock('supernote-typescript', () => ({
	extractMjpegFrame: vi.fn(),
}));

// mirrorFetch.ts calls window.setTimeout/clearTimeout; vitest's default node
// environment has no `window`, so alias it to the global timer functions.
vi.stubGlobal('window', globalThis);

function mockResponse(overrides: Partial<Awaited<ReturnType<typeof requestUrl>>> = {}) {
	return {
		status: 206,
		headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=--BOUNDARY' },
		arrayBuffer: new ArrayBuffer(0),
		json: undefined,
		text: '',
		...overrides,
	};
}

describe('fetchMirrorFrameViaRange', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('requests a bounded Range and returns the decoded frame', async () => {
		const { extractMjpegFrame } = await import('supernote-typescript');
		const fakeImage = { width: 1 } as never;
		vi.mocked(extractMjpegFrame).mockReturnValue(fakeImage);
		vi.mocked(requestUrl).mockResolvedValue(mockResponse());

		const image = await fetchMirrorFrameViaRange('192.168.1.50');

		expect(image).toBe(fakeImage);
		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'http://192.168.1.50:8080/screencast.mjpeg',
				throw: false,
				headers: { Range: `bytes=0-${MIRROR_RANGE_BYTES - 1}` },
			}),
		);
	});

	it('accepts a plain 200 response, not just 206 Partial Content', async () => {
		const { extractMjpegFrame } = await import('supernote-typescript');
		const fakeImage = { width: 1 } as never;
		vi.mocked(extractMjpegFrame).mockReturnValue(fakeImage);
		vi.mocked(requestUrl).mockResolvedValue(mockResponse({ status: 200 }));

		await expect(fetchMirrorFrameViaRange('192.168.1.50')).resolves.toBe(fakeImage);
	});

	it('throws when no complete JPEG frame is found within the ranged bytes', async () => {
		const { extractMjpegFrame } = await import('supernote-typescript');
		vi.mocked(extractMjpegFrame).mockReturnValue(null);
		vi.mocked(requestUrl).mockResolvedValue(mockResponse());

		await expect(fetchMirrorFrameViaRange('192.168.1.50')).rejects.toThrow(
			/didn't find a complete JPEG frame/,
		);
	});

	it('throws on an unexpected status code', async () => {
		vi.mocked(requestUrl).mockResolvedValue(mockResponse({ status: 404 }));

		await expect(fetchMirrorFrameViaRange('192.168.1.50')).rejects.toThrow(
			"Supernote's screen-mirror server returned status 404.",
		);
	});

	it('reports an unreachable device distinctly from a timeout', async () => {
		vi.mocked(requestUrl).mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

		await expect(fetchMirrorFrameViaRange('192.168.1.50')).rejects.toThrow(
			'Could not reach Supernote at 192.168.1.50 (net::ERR_CONNECTION_REFUSED).',
		);
	});

	describe('with fake timers', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		it('gives up if the device ignores Range and keeps streaming past the timeout', async () => {
			const pending = new Promise(() => { /* never resolves */ });
			vi.mocked(requestUrl).mockReturnValue(Object.assign(pending, {
				arrayBuffer: pending.then(() => new ArrayBuffer(0)),
				json: pending.then(() => undefined),
				text: pending.then(() => ''),
			}) as ReturnType<typeof requestUrl>);

			const assertion = expect(fetchMirrorFrameViaRange('192.168.1.50')).rejects.toThrow(
				/doesn't appear to support partial \(Range\) requests/,
			);
			await vi.advanceTimersByTimeAsync(MIRROR_TIMEOUT_MS);
			await assertion;
		});
	});
});
