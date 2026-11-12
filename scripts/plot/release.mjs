import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const repository = 'wdk08/PlotForge';
const origin = `https://github.com/${repository}.git`;
const workflow = `https://github.com/${repository}/actions/workflows/release.yml`;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const requiredSecrets = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'];
const args = process.argv.slice(2);
const first = args[0] === '--first';
const prepared = args[0] === '--prepared';
const currentVersion = first || prepared;
const read = path => readFileSync(path, 'utf8');
const output = (file, args) => execFileSync(file, args, { encoding: 'utf8' }).trim();
const git = (...args) => output('git', args);
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });
const json = value => JSON.stringify(value, null, 2) + '\n';

function require(condition, message) {
  if (!condition) throw new Error(message);
}
function components(version) {
  require(versionPattern.test(version), 'Use a stable version such as 1.2.3.');
  return version.split('.').map(BigInt);
}
function versionFor(choice, current) {
  const [major, minor, patch] = components(current);
  if (choice === 'patch') return `${major}.${minor}.${patch + 1n}`;
  if (choice === 'minor') return `${major}.${minor + 1n}.0`;
  if (choice === 'major') return `${major + 1n}.0.0`;
  return choice;
}
function bumpFiles(current, next) {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
  pkg.version = lock.version = lock.packages[''].version = tauri.version = next;
  const cargoVersion = text => text.replace(/(name = "plotforge"\nversion = ")[^"]+/, (_, prefix) => prefix + next);
  return new Map([
    ['package.json', json(pkg)], ['package-lock.json', json(lock)],
    ['src-tauri/tauri.conf.json', json(tauri)],
    ['src-tauri/Cargo.toml', cargoVersion(read('src-tauri/Cargo.toml'))],
    ['src-tauri/Cargo.lock', cargoVersion(read('src-tauri/Cargo.lock'))],
    ['README.md', read('README.md').replace(`# PlotForge ${current}\n`, `# PlotForge ${next}\n`)],
    ['index.html', read('index.html').replace(`PlotForge ${current} · Forge Studios`, `PlotForge ${next} · Forge Studios`)],
  ]);
}

async function release() {
  if (args.includes('--help')) {
    console.log('npm run release          Choose a patch, minor, major or custom version.\nnpm run release -- --first   Release the current 1.0.0 commit after main is pushed.\nnpm run release -- --prepared   Release the current version without bumping it again.');
    return;
  }
  require(!args.length || currentVersion && args.length === 1, 'Use npm run release -- --help.');
  require(process.stdin.isTTY, 'Run the release command in an interactive terminal.');
  require(!git('status', '--porcelain', '--untracked-files=all'), 'Commit or set aside local changes before releasing.');
  require(git('branch', '--show-current') === 'main', 'Run from the main branch.');
  require(git('remote', 'get-url', 'origin') === origin && git('remote', 'get-url', '--push', 'origin') === origin,
    `Set the fetch and push origin to ${origin}.`);
  const secrets = JSON.parse(output('gh', ['secret', 'list', '--repo', repository, '--json', 'name'])).map(item => item.name);
  const missing = requiredSecrets.filter(secret => !secrets.includes(secret));
  require(!missing.length, `Configure repository secrets ${missing.join(', ')} before releasing. See RELEASE.md.`);
  run('git', ['fetch', 'origin', 'main', '--tags']);
  require(git('rev-parse', 'HEAD') === git('rev-parse', 'origin/main'), 'Synchronize local main with origin/main before releasing.');
  const current = JSON.parse(read('package.json')).version;
  const prior = git('tag', '--list', 'v*', '--sort=-version:refname').split('\n').find(tag => versionPattern.test(tag.slice(1)));
  if (prepared) {
    const next = components(current), previous = prior && components(prior.slice(1));
    const difference = previous ? next.findIndex((value, i) => value !== previous[i]) : -1;
    require(difference >= 0 && next[difference] > previous[difference], 'The prepared version must be newer than the latest release tag.');
  }
  if (first) require(current === '1.0.0' && !git('tag', '--list', 'v*'), 'The first release requires version 1.0.0 and no existing version tags.');

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const originals = new Map();
  let changed, committed = false;
  try {
    const choice = currentVersion ? current : (await prompt.question('Choose patch, minor, major, or enter a custom X.Y.Z version: ')).trim();
    const next = versionFor(choice, current);
    const nextParts = components(next);
    if (!currentVersion) {
      const oldParts = components(current);
      const difference = nextParts.findIndex((part, i) => part !== oldParts[i]);
      require(difference >= 0 && nextParts[difference] > oldParts[difference], 'Choose a version newer than the current release.');
    }
    const tag = `v${next}`;
    require(!git('tag', '--list', tag) && !git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), `${tag} already exists.`);
    run(process.execPath, ['scripts/plot/release-config.mjs']);
    if (!currentVersion) {
      changed = bumpFiles(current, next);
      for (const [path, value] of changed) {
        originals.set(path, read(path));
        writeFileSync(path, value);
      }
      run(process.execPath, ['scripts/plot/release-config.mjs']);
    }
    run('npm', ['run', 'check']);
    run('cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'custom-protocol', '--lib']);
    console.log(`\nPlotForge ${tag}\nRepository  ${repository}\nInstallers  macOS Apple Silicon, macOS Intel, Windows x64\nWorkflow  ${workflow}\n`);
    const answer = (await prompt.question(`Type ${tag} to push the release tag: `)).trim();
    if (answer !== tag) {
      console.log('Release cancelled.');
      return;
    }
    if (changed) {
      const paths = [...changed.keys()];
      require(paths.every(path => read(path) === changed.get(path)), 'A version file changed during validation.');
      require(!git('diff', '--cached', '--name-only'), 'The Git index changed during validation.');
      run('git', ['commit', '-m', `Release PlotForge ${tag}`, '--', ...paths]);
    } else {
      require(!git('status', '--porcelain', '--untracked-files=all'), 'The checkout changed during validation.');
    }
    committed = true;
    run('git', ['tag', '-a', tag, '-m', `PlotForge ${tag}`]);
    try {
      run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
    } catch (error) {
      console.error(`The local commit and tag are retained. Inspect origin before retrying the atomic push of ${tag}.`);
      throw error;
    }
    console.log(`Track installer builds at ${workflow}.\nRelease page after publication: https://github.com/${repository}/releases/tag/${tag}`);
  } finally {
    prompt.close();
    if (!committed && changed) {
      for (const [path, value] of originals) {
        if (read(path) === changed.get(path)) writeFileSync(path, value);
      }
    }
  }
}

release().catch(error => { console.error(error.message); process.exitCode = 1; });
