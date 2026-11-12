import { desktopInvoke } from '../desktop.js';
import { version } from '../../package.json';
import logo from '../../src-tauri/icons/128x128.png';
import { $, button, element, task } from './common.js';

export async function setupUpdates(environment = window) {
  const invoke = desktopInvoke(environment);
  const events = environment.__TAURI__?.event;
  const info = await invoke?.('plot_update_info').catch(() => null) ?? { version, enabled: false };
  const settings = $('settings-dialog');
  const checkButton = $('check-updates');
  const about = element('dialog', 'plot-update-dialog');
  about.id = 'about-plotforge';
  about.innerHTML = '<h1>About PlotForge</h1><p data-version></p><p>A visual story planner for organizing projects, canvases, and media.</p><details><summary>License and source code</summary><p>Copyright © 2026 wdk08. PlotForge is free software under GPLv3, without warranty. Corresponding source is available with official releases.</p><button type="button" data-license>Read License</button><pre hidden></pre></details>';
  const mark = element('img');
  Object.assign(mark, { src: logo, alt: '', width: 64, height: 64 });
  about.prepend(mark);
  about.querySelector('[data-version]').textContent = `Version ${info.version}`;
  about.querySelector('[data-license]').onclick = task(async () => {
    const text = about.querySelector('pre');
    text.textContent = (await import('../../LICENSE?raw')).default;
    text.hidden = false;
  });
  const aboutActions = element('div', 'dialog-actions');
  aboutActions.append(button('Close', () => about.close(), 'quiet-button'));
  if (invoke) aboutActions.append(button('Check for Updates', () => { about.close(); void check(false); }, 'primary-button'));
  about.append(aboutActions);
  document.body.append(about);
  $('about-app').onclick = () => { settings.close(); showAbout(); };
  function showAbout() {
    if (!document.querySelector('dialog[open]')) about.showModal();
  }
  if (!invoke || !events?.listen) return;

  const prompt = element('section', 'plot-update-prompt');
  prompt.hidden = true;
  prompt.setAttribute('aria-label', 'PlotForge updates');
  const headline = element('p');
  headline.setAttribute('role', 'status');
  const laterKey = 'plotforge-update-later';
  let deferredVersion;
  try { deferredVersion = environment.sessionStorage.getItem(laterKey); } catch {}
  function defer() {
    if (update) {
      deferredVersion = update.version;
      try { environment.sessionStorage.setItem(laterKey, deferredVersion); } catch {}
    }
    prompt.hidden = true;
    if (dialog.open) dialog.close();
  }
  prompt.append(headline, button('Later', defer, 'quiet-button'), button('Update Now', () => startDownload(), 'primary-button'));

  const dialog = element('dialog', 'plot-update-dialog');
  dialog.id = 'plotforge-update';
  dialog.innerHTML = '<h1></h1><p data-summary></p><section data-notes><h2>What’s New</h2><pre></pre></section><progress aria-label="Update download progress"></progress><p data-status role="status"></p><p data-error role="alert"></p>';
  const progress = dialog.querySelector('progress'), status = dialog.querySelector('[data-status]');
  const error = dialog.querySelector('[data-error]');
  const actions = element('div', 'dialog-actions');
  const primary = button('', null, 'primary-button');
  const later = button('Close', () => phase === 'available' ? defer() : dialog.close(), 'quiet-button');
  actions.append(later, primary);
  dialog.append(actions);
  document.body.append(prompt, dialog);

  let update, phase = 'idle', busy = false, checking, active = true, releases = [], generation = 0;
  checkButton.hidden = false;
  checkButton.onclick = () => { settings.close(); void check(false); };
  dialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
    else if (phase === 'available') { event.preventDefault(); defer(); }
  });

  function show(next, message = '', failure = '') {
    if (!active) return;
    phase = next;
    const titles = {
      checking: 'Checking for Updates', available: 'PlotForge Update Available',
      downloading: 'Downloading Update', downloaded: 'Update Ready to Install',
      saving: 'Saving Your Work', installing: 'Installing Update',
      installed: 'Update Ready', restarting: 'Restarting PlotForge',
      current: 'PlotForge Is Up to Date', error: 'Could Not Check for Updates',
      downloadError: 'Could Not Download Update', installError: 'Could Not Install Update',
    };
    dialog.querySelector('h1').textContent = titles[next];
    dialog.querySelector('[data-summary]').textContent = update ? `PlotForge v${update.version} · Installed v${info.version}` : `Installed v${info.version}`;
    dialog.querySelector('[data-notes]').hidden = !update?.notes;
    dialog.querySelector('pre').textContent = update?.notes ?? '';
    progress.hidden = next !== 'downloading';
    if (!progress.hidden) progress.removeAttribute('value');
    status.textContent = message;
    error.textContent = failure;
    const command = {
      available: ['Update Now', startDownload], downloaded: ['Install and Restart', install],
      installed: ['Restart Now', restart], downloadError: ['Retry', startDownload], installError: ['Retry', install],
    }[next];
    primary.hidden = !command;
    primary.textContent = command?.[0] ?? '';
    primary.onclick = command?.[1] ?? null;
    later.textContent = next === 'available' ? 'Later' : next === 'installed' ? 'Restart Later' : 'Close';
    later.disabled = busy || next === 'checking';
    if (!dialog.open && !document.querySelector('dialog[open]')) dialog.showModal();
  }

  async function check(automatic) {
    if (!active || busy) return;
    if (!automatic) show('checking');
    if (!info.enabled) {
      if (!automatic) show('error', '', 'Update checks are available in the installed distribution.');
      return;
    }
    const pending = checking ??= invoke('plot_update_check', { automatic });
    try {
      update = await pending;
      if (!active) return;
      if (automatic) {
        if (dialog.open || !update || deferredVersion === update.version) return;
        headline.textContent = `PlotForge v${update.version} is available.`;
        prompt.hidden = false;
      } else {
        prompt.hidden = true;
        show(update?.phase ?? (update ? 'available' : 'current'), update ? '' : 'You’re running the latest version.');
      }
    } catch (failure) {
      if (!automatic) show('error', '', failure?.message ?? String(failure));
    } finally {
      if (checking === pending) checking = undefined;
    }
  }

  async function startDownload() {
    if (!active || busy || !update || document.querySelector('dialog[open]:not(.plot-update-dialog)')) return;
    prompt.hidden = true;
    if (update.phase === 'installed') { show('installed', 'Restart when you are ready.'); return; }
    if (update.phase === 'downloaded') { show('downloaded', 'The download is verified.'); return; }
    busy = true;
    show('downloading', 'Downloading and verifying the update…');
    try {
      await invoke('plot_update_download');
      update.phase = 'downloaded';
    } catch (failure) {
      busy = false;
      show('downloadError', '', failure?.message ?? String(failure));
      return;
    }
    busy = false;
    if (info.platform === 'windows') show('downloaded', 'The installer will save your work, close PlotForge, and apply the update.');
    else await install();
  }

  async function install() {
    if (busy || !active || !update) return;
    busy = true;
    show('saving', 'Waiting for autosave before installation…');
    try {
      await environment.plotForgeBeforeClose();
      if (!active) return;
      show('installing', 'Installing the verified update…');
      await invoke('plot_update_install');
      update.phase = 'installed';
      busy = false;
      show('installed', 'The update is installed. Restart when you are ready.');
    } catch (failure) {
      busy = false;
      show('installError', '', failure?.message ?? String(failure));
    } finally {
      busy = false;
    }
  }

  async function restart() {
    if (busy || !active) return;
    busy = true;
    show('saving', 'Waiting for autosave before restarting…');
    try {
      await environment.plotForgeBeforeClose();
      if (!active) return;
      show('restarting');
      await invoke('plot_update_restart');
    } catch (failure) {
      busy = false;
      show('installed', '', failure?.message ?? String(failure));
    } finally {
      busy = false;
    }
  }

  async function listen() {
    const token = ++generation;
    const registered = await Promise.all([
      events.listen('plotforge-help', ({ payload }) => {
        if (!active) return;
        if (payload === 'about') showAbout();
        else if (payload === 'check' && !document.querySelector('dialog[open]:not(#about-plotforge, #plotforge-update)')) {
          if (about.open) about.close();
          void check(false);
        }
      }),
      events.listen('plotforge-update-progress', ({ payload }) => {
        if (!active || !busy || phase !== 'downloading') return;
        if (payload.total > 0) {
          progress.max = payload.total;
          progress.value = Math.min(payload.downloaded, payload.total);
          status.textContent = `Downloading update… ${Math.floor(progress.position * 100)}%`;
        } else status.textContent = `Downloading update… ${Math.floor(payload.downloaded / 1024)} KB`;
      }),
    ]);
    if (active && generation === token) releases = registered;
    else registered.forEach(release => release());
  }
  environment.addEventListener('pagehide', () => { active = false; generation++; releases.forEach(release => release()); releases = []; });
  environment.addEventListener('pageshow', event => {
    if (event.persisted) { active = true; void listen().then(() => check(true)).catch(console.error); }
  });
  await listen();
  void check(true);
}
