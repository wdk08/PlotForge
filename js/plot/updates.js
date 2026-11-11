import { desktopInvoke } from '../desktop.js';
import { $, button, element } from './common.js';

export async function setupUpdates(environment = window) {
  const invoke = desktopInvoke(environment);
  const events = environment.__TAURI__?.event;
  if (!invoke || !events?.listen) return;
  const info = await invoke('plot_update_info');
  if (!info.enabled) return;

  const checkButton = $('check-updates');
  checkButton.hidden = false;
  const prompt = element('section', 'plot-update-prompt');
  prompt.hidden = true;
  prompt.setAttribute('aria-label', 'PlotForge updates');
  const headline = element('p');
  headline.setAttribute('role', 'status');
  const laterKey = 'plotforge-update-later';
  let deferredVersion;
  try { deferredVersion = environment.sessionStorage.getItem(laterKey); } catch {}
  const later = button('Later', () => {
    if (update) {
      deferredVersion = update.version;
      try { environment.sessionStorage.setItem(laterKey, deferredVersion); } catch {}
    }
    prompt.hidden = true;
  }, 'quiet-button');
  const now = button('Update Now', install, 'primary-button');
  prompt.append(headline, later, now);
  const dialog = element('dialog', 'plot-update-dialog');
  dialog.append(element('h1', null, 'Updating PlotForge'));
  const progress = element('progress');
  progress.setAttribute('aria-label', 'Download progress');
  const status = element('p');
  status.setAttribute('role', 'status');
  const error = element('p');
  error.setAttribute('role', 'alert');
  const actions = element('div', 'dialog-actions');
  const retry = button('Retry', install, 'primary-button');
  const close = button('Close', () => dialog.close(), 'quiet-button');
  actions.append(close, retry);
  dialog.append(progress, status, error, actions);
  document.body.append(prompt, dialog);

  let update, busy = false, checking = false, active = true, unsubscribe, generation = 0;
  const settings = $('settings-dialog');
  checkButton.onclick = () => { settings.close(); void check(false); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

  async function check(automatic) {
    if (checking || busy) return;
    checking = true;
    checkButton.disabled = true;
    try {
      update = await invoke('plot_update_check', { automatic });
      if (!active || automatic && (!update || deferredVersion === update.version)) return;
      headline.textContent = update ? `PlotForge v${update.version} is available.` : `PlotForge v${info.version} is up to date.`;
      now.hidden = !update;
      later.textContent = update ? 'Later' : 'Close';
      prompt.hidden = false;
    } catch (failure) {
      if (!active || automatic) return;
      headline.textContent = `Could not check for updates. ${failure?.message ?? failure}`;
      now.hidden = true;
      later.textContent = 'Close';
      prompt.hidden = false;
    } finally {
      checking = false;
      checkButton.disabled = false;
    }
  }

  async function install() {
    if (busy || !active || !update || document.querySelector('dialog[open]:not(.plot-update-dialog)')) return;
    busy = true;
    prompt.hidden = true;
    retry.hidden = close.hidden = true;
    progress.hidden = false;
    progress.removeAttribute('value');
    status.textContent = 'Downloading and verifying the update…';
    error.textContent = '';
    if (!dialog.open) dialog.showModal();
    try {
      await invoke('plot_update_download');
      if (!active) return;
      progress.hidden = true;
      status.textContent = 'Saving your work before installation…';
      await environment.plotForgeBeforeClose();
      if (!active) return;
      status.textContent = 'Installing the verified update and relaunching PlotForge…';
      await invoke('plot_update_install');
      if (active && info.platform !== 'windows') await invoke('plot_update_restart');
    } catch (failure) {
      if (!active) return;
      progress.hidden = true;
      status.textContent = '';
      error.textContent = `The update could not finish. ${failure?.message ?? failure}`;
      retry.hidden = close.hidden = false;
    } finally {
      busy = false;
    }
  }

  async function listen() {
    const token = ++generation;
    const release = await events.listen('plotforge-update-progress', ({ payload }) => {
      if (!active || !busy || progress.hidden) return;
      if (payload.total > 0) {
        progress.max = payload.total;
        progress.value = Math.min(payload.downloaded, payload.total);
        status.textContent = `Downloading update… ${Math.floor(progress.position * 100)}%`;
      } else {
        status.textContent = `Downloading update… ${Math.floor(payload.downloaded / 1024)} KB`;
      }
    });
    if (active && generation === token) unsubscribe = release;
    else release();
  }
  environment.addEventListener('pagehide', () => { active = false; generation++; unsubscribe?.(); unsubscribe = undefined; });
  environment.addEventListener('pageshow', event => {
    if (event.persisted) { active = true; void listen().then(() => check(true)).catch(console.error); }
  });
  await listen();
  void check(true);
}
