import { $, button, element } from './common.js';
import { boardPath, parents } from './model.js';

export function navigation(onNavigate) {
  const expanded = new Set();
  let project, parentMap, path;
  const name = key => parentMap.get(key)?.element.title || (key === project.root ? project.title : 'Untitled Canvas');
  function renderTree() {
    const tree = document.createDocumentFragment();
    const stack = [{ key: project.root, depth: 0 }];
    while (stack.length) {
      const { key, depth } = stack.pop();
      const board = project.boards[key];
      const children = board.elements.filter(element => element.type === 'canvas');
      const row = element('div', 'board-row');
      row.style.setProperty('--depth', String(Math.min(depth, 8)));
      if (children.length) {
        const open = expanded.has(key);
        const toggle = button(open ? '▾' : '▸', () => {
          if (open) expanded.delete(key); else expanded.add(key);
          renderTree();
          $('board-tree').querySelector(`[data-tree-toggle="${key}"]`)?.focus();
        }, 'tree-disclosure');
        toggle.setAttribute('aria-label', `Toggle ${name(key)} subcanvases`);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.dataset.treeToggle = key;
        row.append(toggle);
        if (open) for (let i = children.length - 1; i >= 0; i--) stack.push({ key: children[i].boardId, depth: depth + 1 });
      } else row.append(element('span', 'tree-disclosure'));
      const title = button(name(key), () => onNavigate(key), 'tree-title');
      title.title = name(key);
      if (key === project.view.active) title.setAttribute('aria-current', 'location');
      row.append(title);
      tree.append(row);
    }
    $('board-tree').replaceChildren(tree);
  }
  return {
    update(next) {
      const moved = project?.view.active !== next.view.active;
      if (!moved && project?.boards === next.boards && project?.title === next.title) return;
      const previous = project;
      project = next;
      const nextMap = parents(next);
      if (!moved && previous?.title === next.title && parentMap?.size === nextMap.size && [...nextMap].every(([key, parent]) =>
        parentMap.get(key)?.board === parent.board && parentMap.get(key)?.element.title === parent.element.title)) {
        parentMap = nextMap;
        return;
      }
      parentMap = nextMap;
      path = boardPath(project, project.view.active, parentMap);
      if (moved) for (const key of path.slice(0, -1)) expanded.add(key);
      if (!previous) expanded.add(project.root);
      $('back').hidden = path.length === 1;
      $('back').onclick = () => onNavigate(path.at(-2));
      $('board-count').textContent = String(parentMap.size + 1);
      $('breadcrumbs').replaceChildren(...path.map((key, index) => {
        const row = element('li');
        const current = index === path.length - 1;
        const item = current ? element('span', null, name(key)) : button(name(key), () => onNavigate(key));
        if (current) item.setAttribute('aria-current', 'location');
        row.append(item);
        return row;
      }));
      $('breadcrumbs').lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      renderTree();
    },
  };
}
