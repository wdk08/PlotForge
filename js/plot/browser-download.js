import { isDesktop } from '../desktop.js';

const repo = 'wdk08/PlotForge';
const releaseAPI = `https://api.github.com/repos/${repo}/releases/latest`;
const releases = `https://github.com/${repo}/releases`;
const installers = [
  ['macOS — Apple Silicon', /^PlotForge_.*_(?:aarch64|arm64)\.dmg$/i],
  ['macOS — Intel', /^PlotForge_.*_(?:x64|x86_64)\.dmg$/i],
  ['Windows — x64', /^PlotForge_.*_(?:x64|x86_64)-setup\.exe$/i],
];

export function releaseInstallers(release) {
  if (!release || release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return [];
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const prefix = `PlotForge_${release.tag_name.slice(1)}_`;
  return installers.flatMap(([label, pattern]) => {
    const matches = assets.filter(asset => asset?.state === 'uploaded' && asset.size > 0 && asset.name?.startsWith(prefix) && pattern.test(asset.name));
    if (matches.length !== 1) return [];
    const asset = matches[0];
    const href = `${releases}/download/${release.tag_name}/${encodeURIComponent(asset.name)}`;
    return asset.browser_download_url === href ? [{ label, href }] : [];
  });
}

export function setupBrowserDownload() {
  if (isDesktop()) return;
  const header = document.querySelector('.header-actions, .library-header');
  const menu = document.createElement('details');
  menu.className = 'export-menu browser-download';
  const summary = document.createElement('summary');
  summary.className = 'quiet-button';
  summary.textContent = 'Download';
  const options = document.createElement('div');
  options.className = 'export-options';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const link = (label, href) => Object.assign(document.createElement('a'), { textContent: label, href, rel: 'noopener' });
  const fallback = link('View PlotForge releases', releases);
  options.append(status, fallback);
  menu.append(summary, options);
  header.append(menu);
  let loading = false, complete = false;
  menu.addEventListener('toggle', async () => {
    if (!menu.open || loading || complete) return;
    loading = true;
    status.textContent = 'Loading downloads…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(releaseAPI, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
      if (response.status === 404) {
        status.textContent = 'Desktop installers are awaiting the first release.';
        return;
      }
      if (!response.ok) throw new Error('Download lookup failed.');
      const available = releaseInstallers(await response.json());
      status.textContent = available.length === installers.length ? '' : 'Some desktop installers are unavailable.';
      status.hidden = !status.textContent;
      options.replaceChildren(...available.map(({ label, href }) => link(label, href)), status, fallback);
      complete = available.length === installers.length;
    } catch {
      status.textContent = 'Desktop downloads are unavailable. Reopen Download to retry.';
    } finally {
      clearTimeout(timeout);
      loading = false;
    }
  });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      menu.open = false;
      summary.focus();
    }
  });
}
