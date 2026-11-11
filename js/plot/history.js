export function projectHistory(limit = 100) {
  const past = [], future = [];
  const content = ({ boards, title, settings, view }) => ({ boards, title, settings, views: view.byBoard });
  function apply(project, entry) {
    const byBoard = Object.fromEntries(Object.keys(entry.boards).flatMap(key => {
      const view = project.view.byBoard[key] ?? entry.views[key];
      return view ? [[key, view]] : [];
    }));
    return {
      ...project, boards: entry.boards, title: entry.title, settings: entry.settings,
      view: { active: entry.boards[project.view.active] ? project.view.active : project.root, byBoard },
    };
  }
  return {
    record(project) {
      past.push(content(project));
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(project) {
      if (!past.length) return project;
      future.push(content(project));
      return apply(project, past.pop());
    },
    redo(project) {
      if (!future.length) return project;
      past.push(content(project));
      return apply(project, future.pop());
    },
    get canUndo() { return Boolean(past.length); },
    get canRedo() { return Boolean(future.length); },
  };
}

export function pruneViews(project) {
  const byBoard = Object.fromEntries(Object.entries(project.view.byBoard).filter(([key]) => project.boards[key]));
  return { ...project, view: { ...project.view, byBoard } };
}
