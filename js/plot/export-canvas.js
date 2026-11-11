import html2canvas from 'html2canvas';
import { boardBounds, endpoints } from './geometry.js';
import { makeCard } from './render.js';
import { mediaSources } from './media.js';

const MAX_SIDE = 4096;
const MAX_PIXELS = 10_000_000;

async function videoPoster(source, model) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    const src = await source(model.asset, model.mime);
    const loaded = await new Promise(resolve => {
      const done = result => { clearTimeout(timer); resolve(result); };
      const timer = setTimeout(() => done(false), 1800);
      video.onloadeddata = () => done(true);
      video.onerror = () => done(false);
      video.src = src;
    });
    if (!loaded || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 720 / video.videoWidth, 720 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL();
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
function drawConnections(context, board, box, scale) {
  const models = new Map(board.elements.map(model => [model.id, model]));
  context.save();
  context.scale(scale, scale);
  context.translate(-box.left, -box.top);
  for (const link of board.connections) {
    const [from, to] = endpoints(models.get(link.from), models.get(link.to));
    context.strokeStyle = context.fillStyle = link.color;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.setLineDash(link.style === 'dashed' ? [7, 5] : link.style === 'dotted' ? [1, 5] : []);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (!link.arrow) continue;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    context.save();
    context.translate(to.x, to.y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-12, 6);
    context.lineTo(-12, -6);
    context.fill();
    context.restore();
  }
  context.restore();
}
function png(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The canvas image could not be encoded.')), 'image/png'));
}

export async function exportCanvas(project, board, store, format) {
  const box = boardBounds(board.elements, 30);
  const width = Math.ceil(box.width), height = Math.ceil(box.height);
  const scale = Math.min(2, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  const surface = document.createElement('div');
  surface.className = 'export-board';
  Object.assign(surface.style, { width: `${width}px`, height: `${height}px`, background: 'transparent' });
  const media = mediaSources(store), pending = [], retained = [];
  const callbacks = {
    source(...args) { const work = media.source(...args); pending.push(work); return work; },
    poster(model) { const work = videoPoster(media.source, model); pending.push(work); return work; },
  };
  // Export uses world coordinates and the whole board, independent of culling and zoom.
  for (const model of board.elements) {
    if (model.asset && model.type !== 'audio') { media.retain(model.asset); retained.push(model.asset); }
    surface.append(makeCard({ ...model, x: model.x - box.left, y: model.y - box.top }, project, callbacks, true));
  }
  document.body.append(surface);
  try {
    await Promise.allSettled(pending);
    await Promise.all([...surface.querySelectorAll('img[src]')].map(image => image.decode?.().catch(() => {}) ?? Promise.resolve()));
    const rendered = await html2canvas(surface, { backgroundColor: null, width, height, scale, logging: false, imageTimeout: 3000, scrollX: 0, scrollY: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, rendered.width);
    canvas.height = Math.max(1, rendered.height);
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--plot-canvas').trim();
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawConnections(context, board, box, scale);
    context.drawImage(rendered, 0, 0);
    if (format === 'png') return await png(canvas);
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const fit = Math.min((pageWidth - 36) / canvas.width, (pageHeight - 36) / canvas.height);
    const w = canvas.width * fit, h = canvas.height * fit;
    pdf.addImage(canvas, 'PNG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h, undefined, 'FAST');
    return pdf.output('blob');
  } finally {
    surface.remove();
    for (const key of retained) media.release(key);
  }
}
