import { isDesktop, setupDesktopLifecycle } from '../desktop.js';
import { setupBrowserDownload } from './browser-download.js';
import { repository, BACKUP_DEFAULTS } from './storage.js';

export const $ = key => document.getElementById(key);
export function element(tag, className, label) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}
export function button(label, action, className) {
  const node = element('button', className, label);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}
export const dateLabel = date => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);

export function report(error) {
  if (error?.name === 'AbortError') return;
  const notice = $('notice');
  if (notice) {
    notice.textContent = error?.message ?? String(error);
    notice.hidden = false;
  }
}
export function task(operation) {
  return (...args) => Promise.resolve().then(() => operation(...args)).catch(report);
}
export function ask(title, message, value, submit = 'Save') {
  const dialog = $('prompt-dialog');
  $('prompt-title').textContent = title;
  $('prompt-message').textContent = message;
  const input = $('prompt-value'), field = input.closest('label');
  field.hidden = value === undefined;
  input.required = !field.hidden;
  input.value = value ?? '';
  $('prompt-ok').textContent = submit;
  return new Promise(resolve => {
    const form = dialog.querySelector('form');
    function finish(result) {
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      dialog.close();
      resolve(result);
    }
    function onSubmit(event) {
      event.preventDefault();
      const accepted = event.submitter?.value === 'ok';
      finish(accepted ? field.hidden ? true : input.value.trim() || null : null);
    }
    function onCancel(event) {
      event.preventDefault();
      finish(null);
    }
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); form.requestSubmit($('prompt-ok')); }
    };
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    if (input.required) { input.focus(); input.select(); }
    else $('prompt-cancel').focus();
  });
}

export async function setupCommon(onSettings, onVersions) {
  for (const input of document.querySelectorAll('[name=appearance]')) {
    input.checked = input.value === window.plotForgeTheme.get();
    input.onchange = () => window.plotForgeTheme.set(input.value);
  }
  setupBrowserDownload();
  const settings = $('settings-dialog');
  $('settings').onclick = () => settings.showModal();
  if (onVersions) $('settings-versions').onclick = () => { settings.close(); onVersions(); };
  $('notice')?.addEventListener('click', () => { $('notice').hidden = true; });
  setupDesktopLifecycle(globalThis, { event: 'plotforge-close-requested', beforeClose: 'plotForgeBeforeClose' }).catch(report);
  if (!isDesktop() && import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('offline.js', document.baseURI)).catch(console.error);
  }
  const backup = { ...BACKUP_DEFAULTS };
  function show() {
    $('backups-enabled').checked = backup.enabled;
    $('backup-interval').value = String(backup.interval);
  }
  show();
  const backupFields = $('backup-fields');
  backupFields.disabled = true;
  function bind() {
    const persist = task(async () => {
      const next = { enabled: $('backups-enabled').checked, interval: Number($('backup-interval').value) };
      await repository.setPreference('backup-settings', next);
      Object.assign(backup, next);
      onSettings?.(backup);
    });
    $('backups-enabled').onchange = persist;
    $('backup-interval').onchange = persist;
    backupFields.disabled = false;
  }
  try {
    const value = await repository.getPreference('backup-settings', BACKUP_DEFAULTS);
    backup.enabled = value.enabled !== false;
    backup.interval = [1, 5, 10, 15, 30].includes(value.interval) ? value.interval : BACKUP_DEFAULTS.interval;
    show();
  } catch (error) { report(error); }
  bind();
  onSettings?.(backup);
}
