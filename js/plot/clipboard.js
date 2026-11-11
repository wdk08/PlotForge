import { createProject, extractSelection, id, validateProject } from './model.js';
import { cleanHTML } from './rich-text.js';
import { STORAGE_NAME } from './storage.js';

const FORMAT = 'application/x-plotforge-selection';
const SESSION = `${STORAGE_NAME}-selection`;
const LIMIT = 2_000_000;
let last;
try { last = JSON.parse(sessionStorage.getItem(SESSION)); } catch {}
const plain = fragment => `PlotForge selection [${fragment.token}]`;

export function copySelection(project, selected, clipboard) {
  const fragment = { ...extractSelection(project, project.view.active, selected), token: id() };
  const json = JSON.stringify(fragment);
  last = fragment;
  try {
    if (json.length < LIMIT) sessionStorage.setItem(SESSION, json);
    else sessionStorage.removeItem(SESSION);
  } catch {}
  if (clipboard) {
    clipboard.setData('text/plain', plain(fragment));
    if (json.length < LIMIT) clipboard.setData(FORMAT, json);
  } else navigator.clipboard?.writeText(plain(fragment)).catch(() => {});
  return fragment;
}

function parse(json) {
  if (!json || json.length >= LIMIT) return null;
  try {
    const fragment = JSON.parse(json);
    const project = createProject();
    Object.assign(project.boards[project.root], { elements: fragment.elements, connections: fragment.connections });
    Object.assign(project.boards, fragment.boards);
    project.view.byBoard = fragment.views;
    validateProject(project);
    for (const board of Object.values(project.boards)) for (const element of board.elements) if (element.html) element.html = cleanHTML(element.html);
    return fragment;
  } catch { return null; }
}

export function readClipboard(clipboard) {
  if (!clipboard) return { fragment: last };
  const text = clipboard.getData('text/plain');
  const fragment = parse(clipboard.getData(FORMAT)) ?? (last && text === plain(last) ? last : null);
  if (fragment) return { fragment };
  const files = [...clipboard.files];
  if (files.length) return { files };
  return { text };
}
