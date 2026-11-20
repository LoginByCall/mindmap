// Форматы .mm / .opml / .xmind ⇄ дерево {text, color, fold, notes, children} — общие для Linux (GTK) и macOS.
// Запись повторяет вывод xml.etree из 0.3.2 байт-в-байт (.xmind — кроме случайных id и сжатия).
window.formats = (() => {
  const t = (s) => (window.I18N || {})[s] ?? s;
  const kids = (e, tag) => [...e.children].filter((c) => c.tagName === tag);
  const words = (s) => s.split(/\s+/).filter(Boolean).join(' ');
  const lines = (s) => s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).map((l) => l.trim()).filter(Boolean);
  const node = (text, color, fold, notes, children) => ({ text, color: color || null, fold, notes, children });

  function xml(bytes) {
    const d = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/xml');
    const err = d.querySelector('parsererror');
    if (err) throw new Error(words(err.textContent));
    return d.documentElement;
  }
  // как xml.etree.ElementTree.tostring: атрибуты в порядке добавления, пустой элемент — «<x />»
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (s) => esc(s).replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#09;');
  const el = (tag, attrs = {}, body = '') => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${escA(v)}"`).join('')}`
    + (body ? `>${body}</${tag}>` : ' />');
  const utf8 = (s) => new TextEncoder().encode(s);

  // ---------- FreeMind / Freeplane ----------
  const mm = {
    read(bytes) {
      const conv = (e) => {
        let text = e.getAttribute('TEXT');
        if (text == null) { const rc = kids(e, 'richcontent')[0]; text = rc ? words(rc.textContent) : ''; }   // Freeplane: текст в <richcontent>
        const note = kids(e, 'richcontent').find((r) => r.getAttribute('TYPE') === 'NOTE');
        const lis = note ? [...note.getElementsByTagName('li')] : [];
        return node(text, kids(e, 'edge')[0]?.getAttribute('COLOR') || e.getAttribute('COLOR'), e.getAttribute('FOLDED') === 'true',
          !note ? [] : lis.length ? lis.map((li) => words(li.textContent)) : lines(note.textContent), kids(e, 'node').map(conv));
      };
      const n = kids(xml(bytes), 'node')[0];
      if (!n) throw new Error(t('В файле нет узла <node>'));
      return conv(n);
    },
    write(tree) {
      const conv = (n) => {
        const a = { TEXT: n.text };
        if (n.color) a.COLOR = n.color;
        if (n.fold && n.children.length) a.FOLDED = 'true';
        return el('node', a, (n.color ? el('edge', { COLOR: n.color }) : '')
          + (n.notes?.length ? `<richcontent TYPE="NOTE"><html><body><ul>${n.notes.map((s) => (s ? `<li>${esc(s)}</li>` : '<li />')).join('')}</ul></body></html></richcontent>` : '')
          + n.children.map(conv).join(''));
      };
      return utf8(el('map', { version: '1.0.1' }, conv(tree)));
    },
  };

  // ---------- OPML ----------
  const opml = {
    read(bytes) {
      const r = xml(bytes);
      const conv = (e) => node(e.getAttribute('text') || '', e.getAttribute('color'), false, lines(e.getAttribute('_note') || ''), kids(e, 'outline').map(conv));
      const outs = kids(r, 'body').flatMap((b) => kids(b, 'outline'));
      if (outs.length === 1) return conv(outs[0]);
      const title = kids(r, 'head').flatMap((h) => kids(h, 'title'))[0];
      return { text: title?.textContent || '', children: outs.map(conv) };
    },
    write(tree) {
      const conv = (n) => {
        const a = { text: n.text };
        if (n.color) a.color = n.color;   // нестандартный атрибут, OPML это допускает
        if (n.notes?.length) a._note = n.notes.join('\n');   // соглашение OmniOutliner/Workflowy
        return el('outline', a, n.children.map(conv).join(''));
      };
      return utf8(`<?xml version='1.0' encoding='utf-8'?>\n`
        + el('opml', { version: '2.0' }, `<head>${tree.text ? `<title>${esc(tree.text)}</title>` : '<title />'}</head>` + el('body', {}, conv(tree))));
    },
  };

  // ---------- XMind 2020+ (zip + content.json) ----------
  const crcT = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc32 = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  // ponytail: без zip64 и шифрования — у карт XMind их не бывает
  async function unzip(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = {};
    let e = b.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error(t('Поддерживается XMind 2020+ (content.json); XMind 8 (content.xml) — нет'));
    for (let i = 0, p = v.getUint32(e + 16, true); i < v.getUint16(e + 10, true); i++) {
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), loc = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
      const start = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true), data = b.subarray(start, start + size);
      out[name] = method !== 8 ? data
        : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    return out;
  }
  function zip(files) {   // только «stored»: XMind и любой unzip это читают
    const parts = [], cd = [];
    // заголовок: длина, подпись, затем [смещение, значение, байт]; дата 33 = 1980-01-01
    const rec = (len, sig, fields) => {
      const h = new DataView(new ArrayBuffer(len));
      h.setUint32(0, sig, true);
      for (const [o, x, s] of fields) (s === 2 ? h.setUint16(o, x, true) : h.setUint32(o, x, true));
      return new Uint8Array(h.buffer);
    };
    let off = 0;
    for (const [name, data] of Object.entries(files)) {
      const n = utf8(name), crc = crc32(data), L = data.length;
      parts.push(rec(30, 0x04034b50, [[4, 20, 2], [12, 33, 2], [14, crc, 4], [18, L, 4], [22, L, 4], [26, n.length, 2]]), n, data);
      cd.push(rec(46, 0x02014b50, [[4, 20, 2], [6, 20, 2], [14, 33, 2], [16, crc, 4], [20, L, 4], [24, L, 4], [28, n.length, 2], [42, off, 4]]), n);
      off += 30 + n.length + L;
    }
    const size = cd.reduce((s, x) => s + x.length, 0), cnt = cd.length / 2;
    const all = [...parts, ...cd, rec(22, 0x06054b50, [[8, cnt, 2], [10, cnt, 2], [12, size, 4], [16, off, 4]])], res = new Uint8Array(off + size + 22);
    all.reduce((o, x) => (res.set(x, o), o + x.length), 0);
    return res;
  }
  const id = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const xmind = {
    async read(bytes) {
      const c = (await unzip(bytes))['content.json'];
      if (!c) throw new Error(t('Поддерживается XMind 2020+ (content.json); XMind 8 (content.xml) — нет'));
      const conv = (x) => node(x.title || '', null, x.branch === 'folded', lines(x.notes?.plain?.content || ''), (x.children?.attached || []).map(conv));
      return conv(JSON.parse(new TextDecoder().decode(c))[0].rootTopic);
    },
    write(tree) {
      const conv = (n) => ({ id: id(), class: 'topic', title: n.text,
        ...(n.notes?.length && { notes: { plain: { content: n.notes.join('\n') } } }),
        ...(n.children.length && { children: { attached: n.children.map(conv) }, ...(n.fold && { branch: 'folded' }) }) });
      const content = [{ id: id(), class: 'sheet', title: tree.text || 'Sheet 1', rootTopic: conv(tree) }];
      return zip({ 'content.json': utf8(JSON.stringify(content)), 'metadata.json': utf8('{}'),
        'manifest.json': utf8(JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } })) });
    },
  };

  // мост передаёт байты файла в base64
  const b64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return { '.mm': mm, '.opml': opml, '.xmind': xmind, b64, unb64 };
})();
