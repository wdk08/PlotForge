import { MAX_ASSET, mediaType } from './format.js';
import { clamp, id, makeElement } from './model.js';

export function mediaSources(store) {
  const cache = new Map();
  function entry(key) {
    if (!cache.has(key)) cache.set(key, { refs: 0 });
    return cache.get(key);
  }
  return {
    retain(key) { entry(key).refs++; },
    release(key) {
      const source = cache.get(key);
      if (!source || --source.refs > 0) return;
      cache.delete(key);
      source.url?.then(url => URL.revokeObjectURL(url)).catch(() => {});
    },
    source(key, mime) {
      const source = entry(key);
      source.url ??= store.getAsset(key).then(blob => {
        if (!blob) throw new Error('Media is missing.');
        return URL.createObjectURL(blob.type === mime ? blob : blob.slice(0, blob.size, mime));
      });
      return source.url;
    },
  };
}

async function probe(blob, type) {
  const url = URL.createObjectURL(blob);
  const media = document.createElement(type === 'image' ? 'img' : type);
  try {
    return await new Promise(resolve => {
      const done = data => { clearTimeout(timer); resolve(data); };
      const ratio = (w, h) => w && h ? clamp(w / h, .001, 1000) : undefined;
      const timer = setTimeout(() => done({}), 2500);
      media.onerror = () => done({});
      if (type === 'image') media.onload = () => done({ ratio: ratio(media.naturalWidth, media.naturalHeight) });
      else {
        media.preload = 'metadata';
        media.onloadedmetadata = () => done({
          ...(type === 'video' ? { ratio: ratio(media.videoWidth, media.videoHeight) } : {}),
          duration: Number.isFinite(media.duration) ? media.duration : undefined,
        });
      }
      media.src = url;
    });
  } finally {
    media.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

export async function storeMedia(file, store, expectedType) {
  const mime = mediaType(file);
  const type = mime?.split('/')[0];
  if (!type || expectedType && type !== expectedType) throw new Error(`Unsupported media format: ${file.name}`);
  if (!file.size || file.size > MAX_ASSET) throw new Error(`Media must be between 1 byte and 512 MiB: ${file.name}`);
  const blob = file.slice(0, file.size, mime);
  const asset = id();
  const meta = await probe(blob, type);
  await store.putAsset(asset, blob);
  return { type, name: file.name.slice(0, 500), mime, asset, ...meta };
}

export async function importMedia(file, x, y, store) {
  const { type, ...options } = await storeMedia(file, store);
  if (options.ratio) {
    const long = 330;
    options.w = Math.max(24, Math.min(long, long * options.ratio));
    options.h = Math.max(24, Math.min(long, long / options.ratio));
  }
  return makeElement(type, x, y, options);
}
