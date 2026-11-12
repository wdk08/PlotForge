import { $, button, element, task } from './common.js';
import { boardLayers, id, LABEL, layerId } from './model.js';
import { elementIndex } from './planning.js';
import { renameVariable, resolveText } from './variables.js';

export function bindPlanningPanels(editor) {
  const variablesDialog = $('variables-dialog');
  const keyField = $('variable-name'), valueField = $('variable-value');
  let oldKey;
  function showVariables(key) {
    const variables = editor.project().variables ?? {};
    oldKey = key;
    keyField.value = key ?? '';
    valueField.value = key ? variables[key] : '';
    $('variable-delete').hidden = !key;
    $('variable-list').replaceChildren(...Object.keys(variables).sort().map(name =>
      button(`{${name}} · ${variables[name]}`, () => showVariables(name))));
  }
  $('variables').onclick = () => { showVariables(); variablesDialog.showModal(); };
  $('variable-new').onclick = () => { showVariables(); keyField.focus(); };
  $('variable-delete').onclick = () => {
    const project = editor.project();
    const variables = { ...project.variables };
    delete variables[oldKey];
    editor.commit({ ...project, variables });
    showVariables();
  };
  $('variable-form').onsubmit = event => {
    event.preventDefault();
    const key = keyField.value.trim();
    try {
      editor.commit(renameVariable(editor.project(), oldKey, key, valueField.value));
      $('variable-error').textContent = '';
      showVariables(key);
    } catch (error) { $('variable-error').textContent = error.message; }
  };

  const layersDialog = $('layers-dialog');
  function updateLayers(next, elements = editor.board().elements, refresh = true) {
    editor.commitBoard({ ...editor.board(), layers: next, elements });
    if (refresh) renderLayers();
  }
  function renderLayers() {
    const board = editor.board(), layers = boardLayers(board);
    const selected = editor.selected();
    const rows = [...layers].reverse().map((layer, index) => {
      const row = element('div', 'layer-row');
      const title = element('input');
      title.type = 'text';
      title.value = layer.title;
      title.maxLength = 160;
      title.setAttribute('aria-label', `Layer name, ${layer.title}`);
      title.onchange = () => {
        title.value = title.value.trim() || layer.title;
        updateLayers(layers.map(item => item.id === layer.id ? { ...item, title: title.value } : item), undefined, false);
      };
      const edit = changes => updateLayers(boardLayers(editor.board()).map(item => item.id === layer.id ? { ...item, ...changes } : item));
      const tool = (label, click, disabled) => {
        const control = button(label, click, 'quiet-button');
        control.disabled = Boolean(disabled);
        return control;
      };
      function move(offset) {
        const next = [...boardLayers(editor.board())], from = next.findIndex(item => item.id === layer.id);
        [next[from], next[from + offset]] = [next[from + offset], next[from]];
        updateLayers(next);
      }
      row.append(title,
        tool(layer.hidden ? 'Show' : 'Hide', () => edit({ hidden: !layer.hidden })),
        tool(layer.locked ? 'Unlock' : 'Lock', () => edit({ locked: !layer.locked })),
        tool('Raise', () => move(1), index === 0),
        tool('Lower', () => move(-1), index === layers.length - 1),
        tool('Move selection here', () => {
          const ids = editor.selected();
          updateLayers(boardLayers(editor.board()), editor.board().elements.map(model => ids.has(model.id) && editor.canEdit(model.id) ? { ...model, layerId: layer.id } : model));
        }, !selected.size || layer.hidden || layer.locked),
        tool('Delete layer', () => {
          const current = editor.board();
          const fallback = boardLayers(current).find(item => item.id === 'default');
          updateLayers(boardLayers(current).filter(item => item.id !== layer.id), current.elements.map(model =>
            layerId(model) === layer.id ? { ...model, layerId: fallback.id } : model));
        }, layer.id === 'default' || layer.locked),
      );
      return row;
    });
    $('layer-list').replaceChildren(...rows);
  }
  $('layers').onclick = () => { renderLayers(); layersDialog.showModal(); };
  $('layer-add').onclick = () => {
    const layers = boardLayers(editor.board());
    updateLayers([...layers, { id: id(), title: `Layer ${layers.length + 1}`, hidden: false, locked: false }]);
    $('layer-list').querySelector('input')?.focus();
  };

  const targetsDialog = $('element-target-dialog');
  const search = $('element-target-search'), targets = $('element-targets');
  let targetAction, candidates = [];
  function renderTargets() {
    const needle = search.value.trim().toLowerCase();
    targets.replaceChildren(...candidates.filter(candidate => candidate.label.toLowerCase().includes(needle)).map(candidate =>
      button(candidate.label, () => {
        targetsDialog.close();
        task(targetAction)(candidate.id);
      })));
    if (!targets.children.length) targets.append(element('p', null, 'No matching elements.'));
  }
  search.oninput = renderTargets;
  return (title, action, { crossCanvas = false, exclude } = {}) => {
    const project = editor.project(), index = elementIndex(project);
    const owners = new Map([...index.values()].filter(({ model }) => model.boardId).map(({ model }) => [model.boardId, model.title]));
    targetAction = action;
    candidates = [...index.values()].flatMap(({ board, model }) => {
      if (model.id === exclude || model.type === 'reference' || model.id === board.background ||
        crossCanvas && board.id === project.view.active) return [];
      const name = resolveText(model.title || model.name || LABEL[model.type], project.variables);
      const boardName = resolveText(owners.get(board.id) ?? project.title, project.variables);
      return [{ id: model.id, label: `${name} · ${boardName}` }];
    });
    $('element-target-title').textContent = title;
    search.value = '';
    renderTargets();
    targetsDialog.showModal();
    search.focus();
  };
}
