// node web/mdtree.test.js
const assert = require('assert');
const { parse, serialize } = require('./mdtree.js');

const shape = (n) => [n.text, n.color || null, !!n.fold, n.children.map(shape)];

const src = `---
title: demo
---

# Проект <!-- color: #e15759 -->

Абзац под корнем

## Цели <!-- markmap: fold -->

- **Первая** цель
  - подцель
    продолжение строки
- Вторая <!-- color: #4e79a7 -->
  \`\`\`js
  - не пункт
  \`\`\`

## Риски

1. Сроки
2. Бюджет
`;

const t = parse(src);
assert.strictEqual(t.text, 'Проект');
assert.strictEqual(t.color, '#e15759');
assert.strictEqual(t.front, '---\ntitle: demo\n---');
assert.deepStrictEqual(t.children.map((c) => c.text), ['Абзац под корнем', 'Цели', 'Риски']);
const goals = t.children[1];
assert.strictEqual(goals.fold, true);
assert.strictEqual(goals.children[0].children[0].text, 'подцель\nпродолжение строки');
assert.strictEqual(goals.children[1].color, '#4e79a7');
assert.ok(goals.children[1].text.includes('- не пункт'), 'код внутри fence не стал пунктом');
assert.deepStrictEqual(t.children[2].children.map((c) => c.text), ['Сроки', 'Бюджет']);

// круговой прогон: структура сохраняется, сериализация идемпотентна
const md1 = serialize(t);
assert.deepStrictEqual(shape(parse(md1)), shape(t));
assert.strictEqual(serialize(parse(md1)), md1);

// пункт списка после подзаголовка должен остаться соседом, а не уйти внутрь подзаголовка
const r = parse('# A\n\n## B\n');
r.children.push({ text: 'C', kind: 'li', children: [] });
assert.deepStrictEqual(shape(parse(serialize(r))), shape(r));

// несколько корней -> виртуальный корень; пустой ввод не падает
const v = parse('- a\n- b\n');
assert.ok(v.virtual);
assert.deepStrictEqual(shape(parse(serialize(v))), shape(v));
assert.strictEqual(parse('').children.length, 0);

// глубже 6 уровней заголовков -> списки, структура не теряется
let deep = { text: 'r', kind: 'h', children: [] }, cur = deep;
for (let i = 0; i < 8; i++) { const c = { text: 'n' + i, kind: 'h', children: [] }; cur.children.push(c); cur = c; }
assert.deepStrictEqual(shape(parse(serialize(deep))), shape(deep));

// список под узлом: под заголовком, под пунктом, у вложенного пункта, у виртуального корня
const nt = parse(`# Корень

## Цели <!-- notes: fold -->
> - срок: май
> - бюджет **10**

- Пункт
  > - заметка
  - Вложенный
    > - глубже
`);
const goals2 = nt.children[0];
assert.deepStrictEqual(goals2.notes, ['срок: май', 'бюджет **10**']);
assert.strictEqual(goals2.notesFold, true);
assert.deepStrictEqual(goals2.children.map((c) => c.text), ['Пункт']);
assert.deepStrictEqual(goals2.children[0].notes, ['заметка']);
assert.deepStrictEqual(goals2.children[0].children[0].notes, ['глубже']);
const nshape = (n) => [n.text, n.notes || null, !!n.notesFold, n.children.map(nshape)];
const nmd = serialize(nt);
assert.deepStrictEqual(nshape(parse(nmd)), nshape(nt));
assert.strictEqual(serialize(parse(nmd)), nmd);
const vr = { text: '', kind: 'h', virtual: true, notes: ['n'], children: [{ text: 'a', kind: 'li', children: [] }] };
assert.deepStrictEqual(nshape(parse(serialize(vr))), nshape(vr));
// абзац со списком становится пунктом, список не теряется
const pr = parse('# A\n\nабзац\n');
pr.children[0].notes = ['x'];
assert.deepStrictEqual(nshape(parse(serialize(pr))), nshape(pr));

console.log('mdtree: ok');
