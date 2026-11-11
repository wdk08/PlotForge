import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseInstallers } from '../../js/plot/browser-download.js';

const release = {
  tag_name: 'v1.0.0', draft: false, prerelease: false,
  assets: ['PlotForge_1.0.0_aarch64.dmg', 'PlotForge_1.0.0_x64.dmg', 'PlotForge_1.0.0_x64-setup.exe']
    .map(name => ({ name, state: 'uploaded', size: 123, browser_download_url: `https://github.com/wdk08/PlotForge/releases/download/v1.0.0/${name}` })),
};

test('PlotForge resolves available platform installers and excludes drafts, duplicates, and foreign links', () => {
  assert.equal(releaseInstallers(release).length, 3);
  assert.deepEqual(releaseInstallers({ ...release, draft: true }), []);
  assert.deepEqual(releaseInstallers({ ...release, tag_name: 'v1.0.1' }), []);
  const assets = [...release.assets, release.assets[0]];
  assets[1] = { ...assets[1], browser_download_url: assets[1].browser_download_url.replace('/PlotForge/', '/ScriptForge/') };
  assert.deepEqual(releaseInstallers({ ...release, assets }).map(item => item.label), ['Windows — x64']);
});
