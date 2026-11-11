import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { releaseInstallers } from '../../js/plot/browser-download.js';

const repository = 'wdk08/PlotForge';
const releaseVersion = /^\d+\.\d+\.\d+$/;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const read = path => readFileSync(path, 'utf8');
const pkg = json('package.json');
const lock = json('package-lock.json');
const config = json('src-tauri/tauri.conf.json');
const updater = config.plugins?.updater;
const version = pkg.version;
const tag = `v${version}`;

assert.match(version, releaseVersion);
assert.equal(pkg.name, 'plotforge');
assert.equal(lock.version, version);
assert.equal(lock.packages[''].version, version);
assert.equal(config.version, version);
assert.equal(config.identifier, 'com.plotforge.desktop');
assert.equal(config.productName, 'PlotForge');
assert.deepEqual(config.bundle.targets, ['app', 'dmg', 'nsis']);
assert.equal(config.bundle.active, true);
assert.equal(config.bundle.createUpdaterArtifacts, true);
for (const file of ['Cargo.toml', 'Cargo.lock']) {
  const cargo = read(`src-tauri/${file}`);
  assert.equal(cargo.match(/name = "plotforge"\nversion = "([^"]+)"/)?.[1], version, file);
}
assert.equal(read('README.md').split('\n')[0], `# PlotForge ${version}`);
assert.ok(read('index.html').includes(`PlotForge ${version} · Forge Studios`));
assert.equal(updater?.requireSignedVersion, true);
assert.deepEqual(updater.endpoints, [`https://github.com/${repository}/releases/latest/download/latest.json`]);
assert.match(Buffer.from(updater.pubkey, 'base64').toString(), /^untrusted comment: minisign public key: [A-F\d]+\r?\nRW[A-Za-z\d+/=]+/);
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, tag);

if (process.argv.includes('--assets')) {
  const release = json('release-assets.json');
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, true);
  const downloadRoot = `https://github.com/${repository}/releases/download`;
  const publicURL = name => `${downloadRoot}/${tag}/${encodeURIComponent(name)}`;
  const assets = release.assets.map(asset => {
    const href = publicURL(asset.name);
    const draftTag = new URL(asset.browser_download_url).pathname.split('/').at(-2);
    const isDraftURL = /^untagged-[a-f0-9]+$/.test(draftTag) &&
      asset.browser_download_url === `${downloadRoot}/${draftTag}/${encodeURIComponent(asset.name)}`;
    assert.ok(asset.browser_download_url === href || isDraftURL, `Unexpected draft download URL for ${asset.name}`);
    return { ...asset, browser_download_url: href };
  });
  const installers = releaseInstallers({ ...release, draft: false, assets });
  assert.equal(installers.length, 3, 'Expected installers for both macOS architectures and Windows x64.');
  const latest = json('release-review/latest.json');
  assert.equal(latest.version.replace(/^v/, ''), version);
  const platforms = [
    ['darwin-aarch64', 'app', /^PlotForge_.*_(?:aarch64|arm64)\.app\.tar\.gz$/],
    ['darwin-x86_64', 'app', /^PlotForge_.*_(?:x64|x86_64)\.app\.tar\.gz$/],
    ['windows-x86_64', 'nsis', /^PlotForge_.*_x64-setup\.exe$/],
  ];
  const files = new Set();
  const canonicalPlatforms = {};
  for (const [platform, bundle, pattern] of platforms) {
    const update = latest.platforms[platform];
    assert.ok(update?.url && update.signature, `Missing signed updater for ${platform}`);
    const url = new URL(update.url);
    const asset = release.assets.find(asset => asset.browser_download_url === url.href ||
      `https://api.github.com/repos/${repository}/releases/assets/${asset.id}` === url.href);
    assert.ok(asset, `Updater URL is outside this release: ${url.href}`);
    const file = asset.name;
    assert.match(file, pattern);
    assert.ok(file.startsWith(`PlotForge_${version}_`), file);
    const canonical = publicURL(file);
    assert.ok(!files.has(file), `Shared updater payload across architectures: ${file}`);
    files.add(file);
    for (const name of [file, `${file}.sig`]) {
      assert.ok(release.assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0), `Missing asset ${name}`);
    }
    assert.equal(read(`release-review/${file}.sig`).trim(), update.signature.trim());
    if (platform === 'windows-x86_64') assert.equal(canonical, installers[2].href);
    canonicalPlatforms[platform] = canonicalPlatforms[`${platform}-${bundle}`] = { signature: update.signature, url: canonical };
  }
  latest.platforms = canonicalPlatforms;
  writeFileSync('release-review/latest.json', JSON.stringify(latest, null, 2) + '\n');
  console.log('Validated all three installer links and signed updater entries.');
} else {
  console.log(`Validated PlotForge ${tag} and its updater configuration.`);
}
