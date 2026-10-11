// Shared inline-SVG icon primitive for this project's standalone custom
// elements (SupernoteViewerElement.ts, SupernoteAtelierViewerElement.ts).
// Extracted from SupernoteViewerElement.ts's own top so both components
// build their (different) icon sets on the same primitive instead of each
// re-implementing createElementNS() boilerplate. See SupernoteViewerElement
// .ts's own FALLBACK_ICONS for why these are hand-drawn rather than pulled
// from an icon library, and why createElementNS() rather than innerHTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgIcon(children: [string, Record<string, string>][]): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of children) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
        svg.appendChild(el);
    }
    return svg;
}
