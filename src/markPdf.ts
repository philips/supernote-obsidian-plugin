import { encode, Image, ImageColorModel } from 'image-js';
import { PDFDocument } from 'pdf-lib';
import { IRenderableNote, SupernoteX, toImage } from 'supernote-typescript';

interface MarkOverlayPage {
	pdfPageNumber: number;
	bounds: ImageBounds;
	overlayPng: Uint8Array;
}

interface ImageBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

function getMarkedPdfPages(mark: SupernoteX): number[] {
	const entries = Object.entries(mark.footer.PAGE)
		.map(([page, offset]) => ({
			pageNumber: Number.parseInt(page, 10),
			offset: Number.parseInt(offset, 10),
		}))
		.filter((entry) => Number.isFinite(entry.pageNumber) && entry.pageNumber > 0)
		.sort((a, b) => {
			const left = Number.isFinite(a.offset) ? a.offset : Number.MAX_SAFE_INTEGER;
			const right = Number.isFinite(b.offset) ? b.offset : Number.MAX_SAFE_INTEGER;
			return left - right;
		});

	return entries.map((entry) => entry.pageNumber);
}

function alphaBounds(rgba: Uint8Array, width: number, height: number): ImageBounds | null {
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const alpha = rgba[(y * width + x) * 4 + 3];
			if (alpha === 0) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}

	if (maxX < minX || maxY < minY) return null;
	return {
		x: minX,
		y: minY,
		width: maxX - minX + 1,
		height: maxY - minY + 1,
	};
}

function cropRgba(rgba: Uint8Array, sourceWidth: number, bounds: ImageBounds): Uint8Array {
	const out = new Uint8Array(bounds.width * bounds.height * 4);
	for (let y = 0; y < bounds.height; y++) {
		const sourceStart = ((bounds.y + y) * sourceWidth + bounds.x) * 4;
		const sourceEnd = sourceStart + bounds.width * 4;
		out.set(rgba.subarray(sourceStart, sourceEnd), y * bounds.width * 4);
	}
	return out;
}

function placement(canvasWidth: number, canvasHeight: number, pageWidth: number, pageHeight: number): { scale: number; offsetX: number; offsetY: number } {
	// The device stores strokes in canvas pixels, while PDF coordinates are
	// points. `scale` is canvas pixels per PDF point, not the inverse.
	const scale = Math.min(canvasWidth / pageWidth, canvasHeight / pageHeight);
	const fittedWidth = pageWidth * scale;
	const fittedHeight = pageHeight * scale;
	return {
		scale,
		offsetX: (canvasWidth - fittedWidth) / 2,
		offsetY: (canvasHeight - fittedHeight) / 2,
	};
}

function buildInkOnlyPage(mark: SupernoteX, pageIndex: number): IRenderableNote {
	const page = mark.pages[pageIndex];
	const layerNames = page.LAYERSEQ.filter((name) => name !== 'BGLAYER');
	const inkOnlyPage = {
		PAGESTYLE: page.PAGESTYLE,
		LAYERSEQ: layerNames,
	} as IRenderableNote['pages'][number];

	for (const name of layerNames) {
		const layer = page[name];
		inkOnlyPage[name] = {
			LAYERNAME: layer.LAYERNAME,
			bitmapBuffer: layer.bitmapBuffer,
		};
	}

	return {
		pageWidth: mark.pageWidth,
		pageHeight: mark.pageHeight,
		pages: [inkOnlyPage],
	};
}

async function buildOverlays(mark: SupernoteX): Promise<MarkOverlayPage[]> {
	const pdfPages = getMarkedPdfPages(mark);
	const overlays: MarkOverlayPage[] = [];

	for (let i = 0; i < mark.pages.length && i < pdfPages.length; i++) {
		const renderable = buildInkOnlyPage(mark, i);
		const rendered = (await toImage(renderable, [1]))[0];
		const { data, width, height } = rendered.getRawImage();
		// toImage constructs every RLE layer as 8-bit RGBA. image-js's raw
		// data type is broader because arbitrary input images may be 16-bit.
		const rgba = data as Uint8Array;
		const bounds = alphaBounds(rgba, width, height);
		if (bounds === null) continue;

		const cropped = cropRgba(rgba, width, bounds);
		const png = encode(new Image(bounds.width, bounds.height, {
			colorModel: ImageColorModel.RGBA,
			data: cropped,
		}));

		overlays.push({
			pdfPageNumber: pdfPages[i],
			bounds,
			overlayPng: png,
		});
	}

	return overlays;
}

export async function markToAnnotatedPdf(mark: SupernoteX, originalPdfBytes: Uint8Array): Promise<Uint8Array | null> {
	const overlays = await buildOverlays(mark);
	if (overlays.length === 0) return null;

	const doc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
	const pages = doc.getPages();
	let stamped = 0;

	for (let i = 0; i < overlays.length; i++) {
		const overlay = overlays[i];
		const page = pages[overlay.pdfPageNumber - 1];
		if (!page) continue;

		const image = await doc.embedPng(overlay.overlayPng);
		const size = page.getSize();
		const rotation = page.getRotation().angle % 360;
		const swapped = rotation === 90 || rotation === 270;
		const viewWidth = swapped ? size.height : size.width;
		const viewHeight = swapped ? size.width : size.height;

		const fit = placement(mark.pageWidth, mark.pageHeight, viewWidth, viewHeight);
		const drawX = (overlay.bounds.x - fit.offsetX) / fit.scale;
		const drawYTop = (overlay.bounds.y - fit.offsetY) / fit.scale;
		const drawWidth = image.width / fit.scale;
		const drawHeight = image.height / fit.scale;
		const drawY = viewHeight - drawYTop - drawHeight;

		page.drawImage(image, {
			x: drawX,
			y: drawY,
			width: drawWidth,
			height: drawHeight,
		});
		stamped++;
	}

	if (stamped === 0) return null;
	return doc.save();
}