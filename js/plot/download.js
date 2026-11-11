import { isDesktop } from '../desktop.js';
import { exportNative } from './storage.js';

export function fileName(title, extension) {
  return (title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 120) || 'Untitled Project') + '.' + extension;
}

export async function download(blob, name) {
  if (isDesktop()) return exportNative(blob, name);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
