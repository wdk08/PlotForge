import { VARIABLE_NAME } from './model.js';

const token = /\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;
export const resolveText = (text, variables = {}) => text.replace(token, (raw, key) => Object.hasOwn(variables, key) ? variables[key] : raw);

export function transformHTML(html, transform) {
  if (!html.includes('{')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const nodes = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  while (nodes.nextNode()) nodes.currentNode.data = transform(nodes.currentNode.data);
  return template.innerHTML;
}

export function renameVariable(project, oldKey, key, value) {
  const current = project.variables ?? {};
  if (!VARIABLE_NAME.test(key)) throw new Error('Use letters, numbers, or underscores, starting with a letter or underscore.');
  if (key !== oldKey && Object.hasOwn(current, key)) throw new Error('A variable already uses that name.');
  const variables = Object.fromEntries([...Object.entries(current).filter(([name]) => name !== oldKey), [key, value]]);
  if (!oldKey || oldKey === key) return { ...project, variables };
  const rename = text => text.replace(token, (raw, name) => name === oldKey ? `{${key}}` : raw);
  const boards = Object.fromEntries(Object.entries(project.boards).map(([id, board]) => [id, {
    ...board,
    layers: board.layers?.map(layer => ({ ...layer, title: rename(layer.title) })),
    ...(board.plan && { plan: { ...board.plan, floors: board.plan.floors.map(floor => ({ ...floor, name: rename(floor.name),
      objects: floor.objects.map(item => item.name ? { ...item, name: rename(item.name) } : item),
    })) } }),
    elements: board.elements.map(model => {
      const result = { ...model };
      for (const field of ['title', 'description', 'date', 'time']) if (typeof model[field] === 'string') result[field] = rename(model[field]);
      if (model.html) result.html = transformHTML(model.html, rename);
      if (model.items) result.items = model.items.map(item => ({ ...item, text: rename(item.text) }));
      return result;
    }),
    connections: board.connections.map(link => link.label ? { ...link, label: { ...link.label, text: rename(link.label.text) } } : link),
  }]));
  return { ...project, title: rename(project.title), boards, variables };
}

export function bindVariableSuggestions(getVariables) {
  const menu = document.createElement('div');
  menu.className = 'variable-suggestions';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Project variables');
  menu.hidden = true;
  document.body.append(menu);
  let apply, choices = [], index = 0;
  const hide = () => { menu.hidden = true; apply = undefined; };
  document.addEventListener('focusout', hide);
  document.addEventListener('input', event => {
    const field = event.target;
    const selection = document.getSelection();
    const editable = field.isContentEditable && selection?.isCollapsed && field.contains(selection.anchorNode);
    const textInput = field.matches('input[type=text], textarea, input:not([type])') && field.selectionStart === field.selectionEnd;
    const offset = editable ? selection.anchorOffset : field.selectionStart;
    const value = editable ? selection.anchorNode?.textContent : textInput ? field.value : '';
    const match = value?.slice(0, offset).match(/\{([A-Za-z_][A-Za-z0-9_]{0,63})?$/);
    if (!match) return hide();
    choices = Object.keys(getVariables() ?? {}).filter(key => key.startsWith(match[1] ?? '')).sort().slice(0, 10);
    if (!choices.length) return hide();
    const start = offset - match[0].length;
    const end = value[offset] === '}' ? offset + 1 : offset;
    const node = editable ? selection.anchorNode : undefined;
    const rect = editable ? selection.getRangeAt(0).getBoundingClientRect() : field.getBoundingClientRect();
    apply = key => {
      hide();
      if (editable && node.nodeType === Node.TEXT_NODE && field.contains(node)) {
        selection.setBaseAndExtent(node, start, node, end);
        document.execCommand('insertText', false, `{${key}}`);
      } else if (textInput) {
        field.setRangeText(`{${key}}`, start, end, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    index = 0;
    menu.replaceChildren(...choices.map((key, at) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(at === index));
      option.textContent = `{${key}}`;
      option.onmousedown = event => event.preventDefault();
      option.onclick = () => apply?.(key);
      return option;
    }));
    const host = field.closest('dialog[open]') ?? document.body;
    if (menu.parentElement !== host) host.append(menu);
    menu.hidden = false;
    menu.style.left = `${Math.max(4, Math.min(innerWidth - menu.offsetWidth - 6, rect.left))}px`;
    menu.style.top = `${Math.max(4, Math.min(innerHeight - menu.offsetHeight - 6, rect.bottom + 4))}px`;
  });
  document.addEventListener('keydown', event => {
    if (menu.hidden || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') hide();
    else if (event.key === 'Enter') apply?.(choices[index]);
    else {
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      [...menu.children].forEach((option, at) => option.setAttribute('aria-selected', String(at === index)));
    }
  }, true);
}
