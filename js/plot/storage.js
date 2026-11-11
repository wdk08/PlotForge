import { createRepository } from './browser-store.js';
import { desktopInvoke, invokeDesktop } from '../desktop.js';
import { id, statistics } from './model.js';

export const DEVELOPMENT = import.meta.env?.DEV || import.meta.env?.MODE === 'development';
export const STORAGE_NAME = DEVELOPMENT ? 'plotforge-development' : 'plotforge-production';
const CHUNK = 4 * 1024 * 1024;
const native = (action, body) => invokeDesktop('plot_storage', { action, body });
const storageChanged = new Set();
async function streamUpload(begin, body, blob) {
  const token = await native(begin, body);
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const data = await blob.slice(offset, offset + CHUNK).arrayBuffer();
      await desktopInvoke()('plot_chunk', data, { headers: { 'x-plotforge-upload': token } });
    }
    await native('finishUpload', { token });
  } catch (error) {
    await native('cancelUpload', { token }).catch(() => {});
    throw Object.assign(new Error(error?.message ?? String(error)), { name: error?.name ?? 'Error' });
  }
}

function nativeRepository() {
  async function change(action, body) {
    const record = await native(action, body);
    for (const listener of storageChanged) listener();
    return record;
  }
  return {
    reconnect() {},
    subscribe(listener) { storageChanged.add(listener); return () => storageChanged.delete(listener); },
    list: () => native('list', {}),
    get: id => native('get', { id }),
    put: (record, revision = null) => change('put', { record, revision }),
    archive: (id, revision) => change('archive', { id, revision }),
    restore: (id, revision) => change('restore', { id, revision }),
    getPreference: async (key, fallback) => (await native('getPreference', { key })) ?? fallback,
    setPreference: (key, value) => native('setPreference', { key, value }),
    hasAsset: async id => (await native('assetSize', { id })) !== null,
    async getAsset(id) {
      const size = await native('assetSize', { id });
      if (size === null) return undefined;
      const parts = [];
      for (let offset = 0; offset < size; offset += CHUNK) {
        const part = await invokeDesktop('plot_asset_chunk', { id, offset, length: Math.min(CHUNK, size - offset) });
        if (!(part instanceof ArrayBuffer) || !part.byteLength) throw new Error('Could not read the media file.');
        parts.push(new Blob([part]));
      }
      return new Blob(parts);
    },
    putAsset: (id, blob) => streamUpload('beginAsset', { id, size: blob.size }, blob),
    addVersion: version => native('addVersion', { version }),
    listVersions: id => native('listVersions', { id }),
    removeVersions: ids => native('removeVersions', { ids }),
  };
}

export const repository = desktopInvoke() ? nativeRepository() : createRepository(undefined, STORAGE_NAME);
export const exportNative = (blob, name) => streamUpload('beginExport', { name, size: blob.size }, blob);

export function recordFor(project) {
  return {
    id: project.id, title: project.title, modifiedAt: Date.now(), stats: statistics(project),
    preview: project.boards[project.root].elements.slice(0, 9).map(({ type, x, y, w, h, fill, angle }) => ({ type, x, y, w, h, fill, angle })),
    recovery: { document: project },
  };
}

export async function createRecord(project, store = repository) {
  return store.put(recordFor(project));
}

export const BACKUP_DEFAULTS = { enabled: true, interval: 10 };
export async function snapshot(project, reason, store = repository) {
  const at = Date.now();
  await store.addVersion({ id: id(), projectId: project.id, at, reason, project });
  if (reason !== 'Automatic Backup') return;
  const versions = await store.listVersions(project.id);
  const days = new Set();
  const expired = [];
  for (const version of versions.sort((a, b) => b.at - a.at)) {
    if (version.reason !== reason) continue;
    const day = new Date(version.at).toDateString();
    if (at - version.at > 35 * 86400000 || days.has(day) && at - version.at > 86400000) expired.push(version.id);
    days.add(day);
  }
  if (expired.length) await store.removeVersions(expired);
}
