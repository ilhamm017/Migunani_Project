import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

let loaded = false;

export const loadEnv = () => {
    if (loaded) return;
    loaded = true;

    const candidates: string[] = [];
    const explicitPath = process.env.DOTENV_CONFIG_PATH;
    if (explicitPath) candidates.push(explicitPath);

    // Typical local dev: run from `back_end/`, while `.env` is placed at repo root.
    candidates.push(path.resolve(process.cwd(), '.env'));
    candidates.push(path.resolve(process.cwd(), '..', '.env'));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            dotenv.config({ path: candidate });
            return;
        }
    }

    // Fallback to dotenv default behavior (looks for `.env` in CWD).
    dotenv.config();
};

