import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,mobileprovision,keystore}', '**/.git/**',
        '**/.scriptforge-local.json', '**/.plotforge-local.json', '**/validation/**', '**/user-data/**', '**/local-data/**'],
    },
  },
  build: {
    outDir: 'dist/plotforge',
    target: ['chrome105', 'edge105', 'safari16'],
    license: { fileName: 'THIRD_PARTY_NOTICES.md' },
    rollupOptions: { input: { library: resolve('index.html'), editor: resolve('editor.html') } },
  },
  plugins: [{
    name: 'plotforge-offline',
    apply: 'build',
    async writeBundle({ dir }) {
      const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile())
        .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(dir.length + 1).replaceAll('\\', '/')).sort();
      const revision = createHash('sha256');
      for (const path of files) revision.update(path).update(await readFile(join(dir, path)));
      const worker = await readFile('scripts/plot/offline-worker.js', 'utf8');
      revision.update(worker);
      await writeFile(join(dir, 'offline.js'), `const CACHE = 'plotforge-${revision.digest('hex').slice(0, 16)}';\nconst FILES = ${JSON.stringify(files)};\n${worker}`);
    },
  }],
});
