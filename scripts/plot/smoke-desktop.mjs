import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'plotforge-native-smoke-'));
try {
  const binary = fileURLToPath(new URL(`../../src-tauri/target/debug/plotforge${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
  const app = spawn(binary, [], {
    env: { ...process.env, PLOTFORGE_NATIVE_SMOKE_DIR: root },
    stdio: 'inherit',
    timeout: 35_000,
  });
  const code = await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.once('exit', resolve);
  });
  const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'));
  if (code !== 0 || !report.success) throw new Error(report.message ?? 'Native smoke test failed.');
  console.log(`Native smoke passed with ${report.canvases} saved canvases and ${report.bytes} round-tripped media bytes.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
