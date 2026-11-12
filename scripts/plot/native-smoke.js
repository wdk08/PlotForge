(async () => {
  const invoke = window.__TAURI__.core.invoke;
  const storage = (action, body) => invoke('plot_storage', { action, body });
  const wait = async predicate => {
    for (let i = 0; i < 150; i++) {
      const result = predicate();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for the native UI.');
  };
  const find = selector => document.querySelector(selector);
  try {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      (await wait(() => find('#new-project:enabled'))).click();
      return;
    }
    await wait(() => !document.body.classList.contains('loading'));
    const info = await invoke('plot_update_info');
    find('#settings').click();
    find('#about-app').click();
    await wait(() => find('#about-plotforge[open] [data-version]')?.textContent === `Version ${info.version}`);
    find('#about-plotforge .quiet-button').click();
    find('[data-insert=canvas]').click();
    (await wait(() => find('[data-type=canvas]'))).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait(() => find('#back:not([hidden])'));
    find('[data-insert=note]').click();
    await wait(() => find('[data-type=note]'));
    find('[data-insert=image]').click();
    await wait(() => find('[data-type=image] .media-upload'));
    await wait(() => find('#save-state').textContent === 'Saved locally');
    const record = await storage('get', { id });
    const project = record.recovery.document;
    const elements = project.boards[project.view.active].elements;
    if (project.view.active === project.root || elements[0]?.type !== 'note' ||
        elements[1]?.type !== 'image' || elements[1].asset !== undefined) {
      throw new Error('The nested canvas was not persisted.');
    }
    const data = new Uint8Array([0, 1, 250, 255]);
    const asset = crypto.randomUUID();
    const token = await storage('beginAsset', { id: asset, size: data.length });
    await invoke('plot_chunk', data, { headers: { 'x-plotforge-upload': token } });
    await storage('finishUpload', { token });
    const result = await invoke('plot_asset_chunk', { id: asset, offset: 0, length: data.length });
    if (!(result instanceof ArrayBuffer) || new Uint8Array(result).some((byte, i) => byte !== data[i]) || result.byteLength !== data.length) {
      throw new Error('Native media IPC did not return the uploaded bytes.');
    }
    await storage('smokeResult', { success: true, canvases: Object.keys(project.boards).length, bytes: result.byteLength });
  } catch (error) {
    await storage('smokeResult', { success: false, message: String(error?.message ?? error) });
  }
})();
