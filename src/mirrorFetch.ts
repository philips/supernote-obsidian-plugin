import { requestUrl } from 'obsidian';
import { extractMjpegFrame } from 'supernote-typescript';
import type { Image } from 'image-js';

// http://IP:8080/screencast.mjpeg is an indefinitely-open multipart MJPEG
// stream (see fetchMirrorFrame in supernote-typescript) that only a raw
// fetch() + ReadableStream reader can consume incrementally. That's
// unavailable on Obsidian mobile's WKWebView (blocks cross-origin fetch to a
// plain-HTTP LAN device) and unusable via requestUrl, which only resolves
// once a response fully completes - something this stream never does on its
// own.
//
// Instead, ask for just a bounded slice of the stream with a Range header.
// If the Supernote's mirror server honors it, it returns a bounded 206 (or
// closes the connection anyway at that many bytes) - something requestUrl
// CAN resolve - and that's normally enough to contain one full JPEG frame.
// If the server ignores Range and just keeps streaming past it, the timeout
// below aborts the wait instead of hanging indefinitely; the underlying
// native request may keep running, but nothing keeps waiting on it.
export const MIRROR_RANGE_BYTES = 2 * 1024 * 1024;
export const MIRROR_TIMEOUT_MS = 8000;

function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
	return key ? headers[key] : undefined;
}

export async function fetchMirrorFrameViaRange(ip: string): Promise<Image> {
	let timeoutHandle: ReturnType<typeof window.setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timeoutHandle = window.setTimeout(
			() => reject(new DOMException('The operation timed out.', 'TimeoutError')),
			MIRROR_TIMEOUT_MS,
		);
	});

	let response;
	try {
		response = await Promise.race([
			requestUrl({
				url: `http://${ip}:8080/screencast.mjpeg`,
				throw: false,
				headers: { Range: `bytes=0-${MIRROR_RANGE_BYTES - 1}` },
			}),
			timeout,
		]);
	} catch (err) {
		const name = (err as { name?: string } | null)?.name;
		if (name === 'TimeoutError') {
			throw new Error(
				`Supernote at ${ip} didn't stop sending screen-mirror data within ${MIRROR_TIMEOUT_MS / 1000}s. `
				+ `Its mirror server doesn't appear to support partial (Range) requests, which mobile capture `
				+ `relies on, so this device/firmware may not support screen mirroring capture from mobile.`
			);
		}
		throw new Error(`Could not reach Supernote at ${ip} (${err instanceof Error ? err.message : String(err)}).`);
	} finally {
		window.clearTimeout(timeoutHandle!);
	}

	if (response.status !== 200 && response.status !== 206) {
		throw new Error(`Supernote's screen-mirror server returned status ${response.status}.`);
	}

	const contentType = headerValue(response.headers, 'content-type') ?? null;
	const frame = extractMjpegFrame(new Uint8Array(response.arrayBuffer), contentType);
	if (!frame) {
		throw new Error(
			`Received ${MIRROR_RANGE_BYTES} bytes from the screen-mirror stream but didn't find a complete `
			+ `JPEG frame in it. The device may not support partial (Range) requests for this endpoint.`
		);
	}
	return frame;
}
