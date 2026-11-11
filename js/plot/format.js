import { assetIds, id, projectElements, validateProject } from './model.js';

const MAGIC = new Uint8Array([80, 76, 70, 0]); // PLF followed by a NUL byte.
const HEADER = 8;
const MAX_MANIFEST = 32 * 1024 * 1024;
export const MAX_ASSET = 512 * 1024 * 1024;
export const MAX_PROJECT = 2 * 1024 * 1024 * 1024;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  oga: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg', aif: 'audio/aiff', aiff: 'audio/aiff',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg',
};
const TYPES = new Set([...Object.values(MIME), 'audio/webm']);
export const accepts = {
  image: 'image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp',
  audio: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.opus,.aiff',
  video: 'video/*,.mp4,.m4v,.mov,.webm,.ogv',
};
export function mediaType(file) {
  const reported = file.type?.toLowerCase().split(';')[0];
  return TYPES.has(reported) ? reported : MIME[file.name?.split('.').at(-1).toLowerCase()];
}

export async function encodeProject(project, getAsset) {
  validateProject(project);
  const assets = [], blobs = [], seen = new Set();
  let size = HEADER;
  for (const element of projectElements(project)) {
    if (!element.asset || seen.has(element.asset)) continue;
    const blob = await getAsset(element.asset);
    if (!blob?.size || blob.size > MAX_ASSET) throw new Error(`Media is missing or too large: ${element.name}`);
    if (!TYPES.has(element.mime) || !element.mime.startsWith(element.type + '/')) throw new Error('Invalid media type.');
    size += blob.size;
    if (size > MAX_PROJECT) throw new Error('A .plf export can contain up to 2 GiB.');
    seen.add(element.asset);
    assets.push({ id: element.asset, size: blob.size, type: element.mime });
    blobs.push(blob);
  }
  const manifest = new TextEncoder().encode(JSON.stringify({ project, assets }));
  if (manifest.length > MAX_MANIFEST || size + manifest.length > MAX_PROJECT) throw new Error('The project is too large to export.');
  const header = new Uint8Array(HEADER);
  header.set(MAGIC);
  new DataView(header.buffer).setUint32(4, manifest.length, true);
  return new Blob([header, manifest, ...blobs], { type: 'application/x-plotforge' });
}

export async function decodeProject(blob) {
  if (blob.size < HEADER || blob.size > MAX_PROJECT) throw new Error('This .plf file has an unsupported size.');
  const header = new Uint8Array(await blob.slice(0, HEADER).arrayBuffer());
  if (MAGIC.some((byte, i) => header[i] !== byte)) throw new Error('This file is not a PlotForge project.');
  const length = new DataView(header.buffer).getUint32(4, true);
  if (!length || length > MAX_MANIFEST || HEADER + length > blob.size) throw new Error('The .plf manifest is incomplete.');
  let manifest;
  try { manifest = JSON.parse(await blob.slice(HEADER, HEADER + length).text()); }
  catch { throw new Error('The .plf manifest could not be read.'); }
  const project = validateProject(manifest?.project);
  if (!Array.isArray(manifest.assets)) throw new Error('Invalid media manifest.');
  const expected = assetIds(project), assets = new Map();
  let offset = HEADER + length;
  for (const item of manifest.assets) {
    if (!item || !expected.has(item.id) || assets.has(item.id) || !Number.isSafeInteger(item.size) ||
        item.size <= 0 || item.size > MAX_ASSET || offset + item.size > blob.size || !TYPES.has(item.type)) throw new Error('Invalid or incomplete project media.');
    assets.set(item.id, blob.slice(offset, offset + item.size, item.type));
    offset += item.size;
  }
  if (offset !== blob.size || assets.size !== expected.size) throw new Error('The project media is incomplete.');
  for (const element of projectElements(project)) if (element.asset) {
    const type = assets.get(element.asset).type;
    if (!type.startsWith(element.type + '/') || element.mime !== type) throw new Error('A media type does not match its project element.');
  }
  return { project, assets };
}

/** Imported assets receive local IDs so two files can never overwrite each other's media. */
export async function importProject(blob, store, cleanHTML = html => html) {
  const { project, assets } = await decodeProject(blob);
  const keys = new Map();
  for (const [key, asset] of assets) {
    const local = id();
    await store.putAsset(local, asset);
    keys.set(key, local);
  }
  for (const element of projectElements(project)) {
    if (element.asset) element.asset = keys.get(element.asset);
    if (element.html) element.html = cleanHTML(element.html);
  }
  // Preserve the portable identity when it has no local collision.
  if (await store.get(project.id)) project.id = id();
  return project;
}
