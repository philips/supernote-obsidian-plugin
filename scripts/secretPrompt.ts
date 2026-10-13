import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';

interface Keypress {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
}

export async function promptForSecret(message: string): Promise<string> {
    if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
        throw new Error('Hidden Cloud credential prompts require an interactive terminal');
    }

    stdout.write(message);
    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();
    stdin.setRawMode(true);
    stdin.resume();

    return new Promise<string>((resolve, reject) => {
        let value = '';
        const finish = (result?: string, error?: Error) => {
            stdin.off('keypress', onKeypress);
            stdin.setRawMode(wasRaw);
            if (wasPaused) stdin.pause();
            stdout.write('\n');
            if (error) reject(error);
            else resolve(result ?? '');
        };
        const onKeypress = (character: string, key: Keypress) => {
            if (key.ctrl && key.name === 'c') {
                finish(undefined, new Error('Cloud protocol prompt cancelled'));
                return;
            }
            if (key.name === 'return' || key.name === 'enter') {
                finish(value);
                return;
            }
            if (key.name === 'backspace') {
                value = [...value].slice(0, -1).join('');
                return;
            }
            if (!key.ctrl && !key.meta && character && !/[\u0000-\u001f\u007f]/.test(character)) {
                value += character;
            }
        };
        stdin.on('keypress', onKeypress);
    });
}