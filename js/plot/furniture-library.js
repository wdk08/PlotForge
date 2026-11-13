import { $, ask, button, element, task } from './common.js';
import { download } from './download.js';
import { repository } from './storage.js';
import { bindToolbarDrag } from './toolbar-drag.js';
import { FURNITURE, FURNITURE_CATEGORIES } from './furniture-catalog.js';
import { FURNITURE_PREFERENCE, MAX_LIBRARY_BYTES, furnitureLibraryFile, newTemplate, readFurnitureLibrary } from './furniture-data.js';
import { bindFurnitureDesigner } from './furniture-designer.js';
import { furniturePreview } from './furniture-render.js';

export function bindFurnitureLibrary({ canvas, unit, pick, drop, close }) {
  const panel = $('floor-furniture'), results = $('furniture-results'), search = $('furniture-search');
  const back = $('furniture-categories'), heading = $('furniture-category'), file = $('furniture-file');
  const design = bindFurnitureDesigner();
  const pageSize = 36;
  let templates = [], category, choice, shown = pageSize, pending = Promise.resolve(), readVersion = 0;
  async function load() {
    const version = ++readVersion;
    const saved = await repository.getPreference(FURNITURE_PREFERENCE, furnitureLibraryFile([]));
    if (version !== readVersion) return;
    templates = readFurnitureLibrary(saved);
    render();
  }
  const refresh = task(load);
  // Apply changes to the latest saved library so an editor left open in another project sees updates.
  function write(change) {
    const operation = pending.then(async () => {
      const current = readFurnitureLibrary(await repository.getPreference(FURNITURE_PREFERENCE, furnitureLibraryFile([])));
      const value = furnitureLibraryFile(change(current));
      const serialized = JSON.stringify(value);
      if (new Blob([serialized]).size > MAX_LIBRARY_BYTES) throw new Error('This furniture library exceeds 4 MiB.');
      const next = readFurnitureLibrary(value);
      await repository.setPreference(FURNITURE_PREFERENCE, value);
      readVersion++;
      templates = next;
      render();
    });
    pending = operation.catch(() => {});
    return operation;
  }
  function save(template) {
    return write(current => current.some(item => item.id === template.id) ?
      current.map(item => item.id === template.id ? template : item) : [...current, template]);
  }
  function enterCategory(key) {
    category = key;
    shown = pageSize;
    search.value = '';
    render();
  }
  function edit(template, title = 'Edit Custom Furniture') {
    design(template, { title, unit: unit(), async save(item) {
      await save(item);
      if (title !== 'Edit Custom Furniture') enterCategory('my');
    } });
  }
  function tile(definition, custom) {
    const card = element('div', 'furniture-tile');
    const control = button(definition.name, event => {
      const rect = control.getBoundingClientRect();
      if (event.detail && (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom)) return;
      pick(definition);
    }, 'furniture-place');
    control.prepend(furniturePreview({ ...definition, variant: custom ? 'custom' : definition.id }));
    control.dataset.insert = definition.id;
    control.setAttribute('aria-pressed', String(choice === definition.id));
    card.append(control);
    if (custom) {
      const management = element('div', 'furniture-tile-actions');
      for (const [label, action] of [
        ['Edit', () => edit(definition)],
        ['Duplicate', () => edit({ ...definition, id: crypto.randomUUID(), name: `${definition.name.slice(0, 150)} copy` }, 'Duplicate Custom Furniture')],
        ['Delete', task(async () => {
          if (await ask('Delete furniture template?', `Delete “${definition.name}” from My Furniture? Placed copies will stay in your projects.`, undefined, 'Delete Template')) {
            await write(current => current.filter(item => item.id !== definition.id));
          }
        })],
      ]) {
        const item = button(label, action, 'quiet-button');
        item.setAttribute('aria-label', `${label} ${definition.name}`);
        management.append(item);
      }
      card.append(management);
    }
    return card;
  }
  function render() {
    const query = search.value.trim().toLowerCase();
    back.hidden = !category;
    heading.hidden = !category;
    heading.textContent = category ? FURNITURE_CATEGORIES[category][0] : '';
    if (!category && !query) {
      results.className = 'furniture-category-list';
      results.replaceChildren(...Object.entries(FURNITURE_CATEGORIES).map(([key, [name, icon]]) => {
        const control = button(name, () => enterCategory(key));
        const mark = element('span', null, icon);
        mark.setAttribute('aria-hidden', 'true');
        control.prepend(mark);
        return control;
      }));
      return;
    }
    results.className = 'furniture-tile-grid';
    const matches = item => item.name.toLowerCase().includes(query);
    const builtins = Object.values(FURNITURE).filter(item => (!category || item.category === category) && matches(item));
    const custom = templates.filter(item => (!category || category === 'my' || item.category === category) && matches(item));
    const entries = [...builtins, ...custom];
    results.replaceChildren(...entries.slice(0, shown).map(item => tile(item, Boolean(item.design))));
    if (entries.length > shown) {
      results.append(button('Show More', () => { shown += pageSize; render(); }, 'furniture-empty secondary-button'));
    }
    if (category === 'misc' && !query) results.append(button('Custom shapes', () => edit(newTemplate('misc'), 'Create Custom Furniture'), 'secondary-button'));
    if (!results.children.length) results.append(element('p', 'furniture-empty', query ? 'No furniture matches your search.' : 'No saved furniture in this category.'));
  }
  bindToolbarDrag(results, canvas, (key, event) => {
    const item = Object.hasOwn(FURNITURE, key) ? FURNITURE[key] : templates.find(template => template.id === key);
    if (item) drop(item, event);
  });
  back.onclick = () => enterCategory(undefined);
  $('furniture-close').onclick = close;
  search.oninput = () => { shown = pageSize; render(); };
  $('furniture-create').onclick = () => edit(newTemplate(category), 'Create Custom Furniture');
  $('furniture-import').onclick = () => file.click();
  file.onchange = task(async () => {
    const source = file.files[0];
    file.value = '';
    if (!source) return;
    if (source.size > MAX_LIBRARY_BYTES) throw new Error('A furniture library file can be up to 4 MiB.');
    let value;
    try { value = JSON.parse(await source.text()); } catch { throw new Error('This furniture library is not valid JSON.'); }
    const incoming = readFurnitureLibrary(value);
    await write(current => {
      const ids = new Set(current.map(item => item.id));
      return [...current, ...incoming.map(item => ids.has(item.id) ? { ...item, id: crypto.randomUUID() } : item)];
    });
    enterCategory('my');
  });
  $('furniture-export').onclick = task(async () => {
    await pending;
    await load();
    await download(new Blob([JSON.stringify(furnitureLibraryFile(templates))], { type: 'application/json' }), 'PlotForge Furniture Library.json');
  });
  render();
  void refresh();
  return {
    open() {
      if (!panel.hidden) return;
      panel.hidden = false;
      void refresh();
    },
    hide() { panel.hidden = true; },
    select(item) {
      choice = item?.id;
      for (const control of results.querySelectorAll('[data-insert]')) control.setAttribute('aria-pressed', String(control.dataset.insert === choice));
    },
    createFrom(selection) {
      edit({ ...newTemplate(category), ...selection }, 'Create Custom Furniture');
    },
    editInstance(item, save) {
      design({ ...item, category: 'my' }, { title: 'Edit Furniture Instance', unit: unit(), instance: true, save });
    },
  };
}
