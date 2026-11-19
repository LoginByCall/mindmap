// Markdown <-> дерево. Узел: {text, kind: 'h'|'li'|'p', color?, fold?, notes?: [строки], notesFold?, children[]}.
// Структуру дают заголовки, пункты списков и абзацы (как в markmap).
// Цвет ветки хранится комментарием <!-- color: #hex -->, свёртка — штатным <!-- markmap: fold -->.
// Список под названием узла (notes) — цитата «> - пункт» сразу под узлом, свёрнут — <!-- notes: fold -->.
(function (exp) {
  const COLOR_RE = /\s*<!--\s*color:\s*([^>]*?)\s*-->/;
  const FOLD_RE = /\s*<!--\s*markmap:\s*fold\s*-->/;
  const NFOLD_RE = /\s*<!--\s*notes:\s*fold\s*-->/;
  const QUOTE_RE = /^(\s*)>\s?(.*)$/;
  const H_RE = /^(#{1,6})\s+(.*)$/;
  const LI_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
  const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
  const indentOf = (s) => s.match(/^\s*/)[0].replace(/\t/g, '    ').length;

  function mk(raw, kind) {
    const n = { text: '', kind, children: [] };
    let t = raw;
    const c = t.match(COLOR_RE);
    if (c) { n.color = c[1]; t = t.replace(COLOR_RE, ''); }
    if (FOLD_RE.test(t)) { n.fold = true; t = t.replace(FOLD_RE, ''); }
    if (NFOLD_RE.test(t)) { n.notesFold = true; t = t.replace(NFOLD_RE, ''); }
    n.text = t.trim();
    return n;
  }

  function parse(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let i = 0, front = '';
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) { front = lines.slice(0, end + 1).join('\n'); i = end + 1; }
    }
    const top = { kind: 'h', level: 0, children: [] };
    const heads = [top];
    let items = [], para = null, fence = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (fence) {
        fence.node.text += '\n' + line.slice(Math.min(fence.indent, indentOf(line)));
        if (line.trim().startsWith(fence.mark) && !line.trim().slice(fence.mark.length).trim()) fence = null;
        continue;
      }
      if (!line.trim()) { para = null; continue; }
      let m = line.match(QUOTE_RE);
      if (m) {   // пункт списка под узлом: владелец — ближайший менее отступленный пункт, иначе заголовок
        const ind = indentOf(m[1]);
        const owner = items.findLast((it) => it.indent < ind)?.node || heads.at(-1);
        const t = m[2].trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '');
        if (t) (owner.notes ||= []).push(t);
        para = null;
        continue;
      }
      m = line.match(H_RE);
      if (m) {
        const level = m[1].length, n = mk(m[2], 'h');
        while (heads.at(-1).level >= level) heads.pop();
        heads.at(-1).children.push(n);
        n.level = level; heads.push(n); items = []; para = null;
        continue;
      }
      m = line.match(LI_RE);
      if (m && !FENCE_RE.test(line)) {
        const indent = indentOf(m[1]), n = mk(m[2], 'li');
        while (items.length && items.at(-1).indent >= indent) items.pop();
        (items.length ? items.at(-1).node : heads.at(-1)).children.push(n);
        items.push({ node: n, indent }); para = null;
        continue;
      }
      // строка-блок: продолжение пункта списка, абзаца или новый абзац
      const ind = indentOf(line), fm = line.match(FENCE_RE);
      const owner = items.findLast((it) => it.indent < ind);
      let target;
      if (owner) { target = owner.node; target.text += '\n' + line.slice(ind); }
      else if (para) { target = para; para.text += '\n' + line.trim(); }
      else {
        items = [];
        target = para = mk(fm ? line.slice(ind) : line.trim(), 'p');
        heads.at(-1).children.push(para);
      }
      if (fm) { fence = { node: target, mark: fm[2], indent: ind }; para = null; }
    }
    const root = top.children.length === 1 && top.children[0].kind !== 'p' && !top.notes
      ? top.children[0]
      : { text: '', kind: 'h', virtual: true, children: top.children, ...(top.notes && { notes: top.notes }) };
    if (front) root.front = front;
    strip(root);
    return root;
  }

  function strip(n) { delete n.level; n.children.forEach(strip); }

  function lineText(n) {
    // метки — в конец первой строки: в многострочном тексте последняя строка может быть закрытием ```
    let [first, ...rest] = n.text.split('\n');
    if (n.color) first += ` <!-- color: ${n.color} -->`;
    if (n.fold && n.children.length) first += ' <!-- markmap: fold -->';
    if (n.notesFold && n.notes?.length) first += ' <!-- notes: fold -->';
    return [first, ...rest].join('\n');
  }

  function serialize(root) {
    const out = [];
    const blank = () => { if (out.length && out.at(-1) !== '') out.push(''); };
    const notes = (n, pad) => (n.notes || []).forEach((t) => out.push(pad + '> - ' + t.replace(/\n/g, ' ')));
    // hl — уровень заголовка-родителя, ld — глубина в списке (-1 вне списка)
    function emit(n, hl, ld, forceH) {
      let kind = n.kind;
      if (ld >= 0 || (kind === 'p' && (n.children.length || n.notes?.length))) kind = 'li';
      if (forceH) kind = 'h';
      if (kind === 'h' && hl >= 6) kind = 'li';
      if (kind === 'h') {
        blank(); out.push('#'.repeat(hl + 1) + ' ' + lineText(n).replace(/\n/g, ' ')); notes(n, ''); out.push('');
        kids(n, hl + 1, -1);
      } else if (kind === 'p') {
        blank(); out.push(lineText(n)); out.push('');
      } else {
        const pad = '  '.repeat(Math.max(ld, 0));
        const [first, ...rest] = lineText(n).split('\n');
        out.push(pad + '- ' + first, ...rest.map((l) => (l ? pad + '  ' + l : '')));
        notes(n, pad + '  ');
        n.children.forEach((c) => emit(c, hl, Math.max(ld, 0) + 1, false));
      }
    }
    // после первого подзаголовка все следующие соседи тоже должны быть заголовками,
    // иначе Markdown отнесёт их к предыдущему подзаголовку
    function kids(n, hl, ld) {
      let seenH = false;
      for (const c of n.children) {
        const isH = c.kind === 'h' && hl < 6;
        seenH = seenH || isH;
        emit(c, hl, ld, seenH && hl < 6);
      }
    }
    if (root.front) out.push(root.front, '');
    if (root.virtual) { notes(root, ''); blank(); kids(root, 0, -1); } else emit(root, 0, -1, false);
    while (out.length && out.at(-1) === '') out.pop();
    return out.join('\n') + '\n';
  }

  exp.parse = parse;
  exp.serialize = serialize;
})(typeof module !== 'undefined' ? module.exports : (window.mdtree = {}));
