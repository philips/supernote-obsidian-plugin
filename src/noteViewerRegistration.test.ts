import { describe, expect, it, vi } from 'vitest';
import { tryRegisterNoteViewer } from './noteViewerRegistration';

describe('note viewer registration', () => {
    it('registers the extension when enabled', () => {
        const register = vi.fn();
        expect(tryRegisterNoteViewer(true, register)).toBe(true);
        expect(register).toHaveBeenCalledOnce();
    });

    it('does not claim the extension when disabled', () => {
        const register = vi.fn();
        expect(tryRegisterNoteViewer(false, register)).toBe(false);
        expect(register).not.toHaveBeenCalled();
    });

    it('reports a conflict without propagating the registration error', () => {
        expect(tryRegisterNoteViewer(true, () => { throw new Error('extension already registered'); })).toBe(false);
    });
});