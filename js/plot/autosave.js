import { recordFor, repository } from './storage.js';

export function autosave(initialRecord, onState, store = repository, delay = 320) {
  let revision = initialRecord.revision, pending, writing, timer, failed = false;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), delay);
  }
  function queue(project) {
    pending = project;
    if (!failed) onState('Saving locally…');
    schedule();
  }
  function flush() {
    clearTimeout(timer);
    if (writing) return writing;
    if (!pending) return Promise.resolve();
    writing = (async () => {
      try {
        while (pending) {
          const project = pending;
          pending = undefined;
          try { revision = (await store.put(recordFor(project), revision)).revision; }
          catch (error) { pending ??= project; throw error; }
        }
        failed = false;
        onState('Saved locally');
      } catch (error) {
        failed = true;
        onState('Save failed', error);
        throw error;
      }
    })().finally(() => { writing = undefined; });
    return writing;
  }
  return { queue, flush, get dirty() { return Boolean(writing || pending); } };
}
