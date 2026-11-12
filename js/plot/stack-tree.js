const trees = new WeakMap();

export function stackTree(elements, cache = true) {
  if (cache && trees.has(elements)) return trees.get(elements);
  const byId = new Map(elements.map(model => [model.id, model]));
  const children = new Map();
  for (const model of elements) {
    if (!children.has(model.stackId)) children.set(model.stackId, []);
    children.get(model.stackId).push(model);
  }
  const tree = { byId, children, roots: children.get(undefined) ?? [] };
  if (cache) trees.set(elements, tree);
  return tree;
}

export function* stackWalk(roots, children) {
  const pending = [...roots].reverse();
  while (pending.length) {
    const model = pending.pop();
    yield model;
    const members = children.get(model.id) ?? [];
    for (let i = members.length - 1; i >= 0; i--) pending.push(members[i]);
  }
}
export function stackFamily(elements, ids) {
  const { byId, children } = stackTree(elements);
  const family = new Set(), pending = [...ids];
  while (pending.length) {
    const id = pending.pop();
    if (family.has(id) || !byId.has(id)) continue;
    family.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  return family;
}
export function stackAncestors(elements, key) {
  const { byId } = stackTree(elements);
  const ancestors = [];
  for (let parent = byId.get(byId.get(key)?.stackId); parent; parent = byId.get(parent.stackId)) ancestors.push(parent);
  return ancestors;
}
export function topSelected(elements, selected) {
  const { roots, children } = stackTree(elements);
  const pending = [...roots], top = new Set();
  while (pending.length) {
    const model = pending.pop();
    if (selected.has(model.id)) top.add(model.id);
    else for (const child of children.get(model.id) ?? []) pending.push(child);
  }
  return top;
}
