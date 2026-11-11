const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'P', 'DIV', 'H1', 'H2', 'H3', 'SPAN', 'BLOCKQUOTE', 'FONT']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE', 'SVG', 'MATH']);
const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]{1,20})$/i;

export function cleanHTML(html) {
  const input = document.createElement('template'), output = document.createElement('div');
  input.innerHTML = html;
  const pending = [{ source: input.content, destination: output }];
  while (pending.length) {
    const { source, destination } = pending.pop();
    const next = [];
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { destination.append(document.createTextNode(child.data)); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || DROP.has(child.tagName.toUpperCase())) continue;
      let parent = destination;
      if (TAGS.has(child.tagName)) {
        parent = document.createElement(child.tagName === 'FONT' ? 'span' : child.tagName.toLowerCase());
        const style = child.style;
        const color = child.getAttribute('color') || style.color;
        if (COLOR.test(color)) parent.style.color = color;
        if (COLOR.test(style.backgroundColor)) parent.style.backgroundColor = style.backgroundColor;
        if (/^(bold|[1-9]00)$/.test(style.fontWeight)) parent.style.fontWeight = style.fontWeight;
        if (style.fontStyle === 'italic') parent.style.fontStyle = 'italic';
        if (/^(?:underline|line-through)(?: (?:underline|line-through))?$/.test(style.textDecorationLine)) parent.style.textDecorationLine = style.textDecorationLine;
        if (['left', 'center', 'right', 'justify'].includes(style.textAlign)) parent.style.textAlign = style.textAlign;
        destination.append(parent);
      }
      // Preserve the original order when an unsupported wrapper is unwrapped.
      if (parent === destination) {
        const placeholder = document.createElement('span');
        destination.append(placeholder);
        next.push({ source: child, destination: placeholder });
      } else next.push({ source: child, destination: parent });
    }
    for (let i = next.length - 1; i >= 0; i--) pending.push(next[i]);
  }
  return output.innerHTML;
}

export function pasteText(event) {
  event.preventDefault();
  const html = event.clipboardData?.getData('text/html');
  if (html) document.execCommand('insertHTML', false, cleanHTML(html));
  else document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
}
