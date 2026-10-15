export function tryRegisterNoteViewer(enabled: boolean, register: () => void): boolean {
    if (!enabled) return false;
    try {
        register();
        return true;
    } catch {
        return false;
    }
}