import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Environnement isolé : base en mémoire, clé dans un dossier temporaire.
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ainai-test-'));
process.env.SECRET_KEY = 'test-secret';
process.env.ADMIN_PASSWORD = 'motdepasse-test';
