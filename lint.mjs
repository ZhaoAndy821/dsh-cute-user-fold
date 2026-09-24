#!/usr/bin/env node
/**
 * dsh-cute-user-fold · 静态约束检查
 *
 * 这些检查全部来自**已经踩过的坑**，不是泛泛的代码风格洁癖。
 * 每条都对应一个曾真实发生过、且后果是「静默失效」或「整棵树炸掉」的故障。
 *
 * 用法：node lint.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const results = [];
let failed = 0;

function check(label, fn) {
  try {
    const detail = fn();
    results.push(`✅ ${label.padEnd(52)} ${detail ?? ''}`);
  } catch (err) {
    failed += 1;
    results.push(`❌ ${label.padEnd(52)} ${err.message}`);
  }
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

/** 剥离 CSS 注释 —— 注释里可以自由地举反例，不该被规则拦截。 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS_SRC = read('styles/cute-user-fold.css');
const CLIENT = read('lib/client.js');
const PATCH = read('cordis.patch.yml');
const PKG = JSON.parse(read('package.json'));

const inlineCss = (() => {
  const m = CLIENT.match(/const CSS = `([\s\S]*?)`;/);
  must(m !== null, 'lib/client.js 里找不到 `const CSS = `…`;`');
  // 去掉首尾的同步标记行
  return m[1]
    .replace(/^\/\* @cuf:css:begin[^\n]*\n/, '')
    .replace(/\/\* @cuf:css:end \*\/$/, '');
})();

const liveCss = stripCssComments(CSS_SRC);

// ── A. CSS 双副本必须一致 ───────────────────────────────────────────────────
check('A. CSS 源码与内联副本一致', () => {
  must(
    CSS_SRC.trim() === inlineCss.trim(),
    'styles/cute-user-fold.css 与 lib/client.js 的 CSS 常量不一致\n' +
      '  ⇒ 跑 `npm run sync-css`（漂移的后果是静默的：改了源码但浏览器无变化）',
  );
  return `${CSS_SRC.length} 字符，一致`;
});

// ── B. bundle 注册键必须等于包名 ────────────────────────────────────────────
check('B. bundle 注册键 = 包名', () => {
  const m = CLIENT.match(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/);
  must(m !== null, '找不到 `__ModuleLoader__.load({ id: … })`');
  must(
    m[1] === PKG.name,
    `注册键 = "${m[1]}"，包名 = "${PKG.name}"\n` +
      '  ⇒ 必须相等，否则浏览器抛 "loaded without registering"，整棵插件树失败',
  );
  return `id = ${m[1]}`;
});

// ── B2. patch 行的 name 必须指向本包 ────────────────────────────────────────
check('B2. cordis.patch.yml 的 name 指向本包', () => {
  const name = PATCH.match(/^\s*name:\s*'?([^'\r\n]+?)'?\s*$/m);
  must(name !== null, 'cordis.patch.yml 里找不到 name');
  must(
    name[1].trim() === PKG.name,
    `patch 行 name = "${name[1].trim()}"，包名 = "${PKG.name}"`,
  );
  const id = PATCH.match(/^\s*-\s*id:\s*(\S+)\s*$/m);
  must(id !== null, '找不到 `- id:` 挂载行');
  return `patch id = ${id[1]} / name = ${name[1].trim()}`;
});

// ── C. 不得引用构建哈希类名 ─────────────────────────────────────────────────
check('C. CSS 不含构建哈希类名', () => {
  const hits = [...liveCss.matchAll(/\.[A-Za-z0-9]{5,}_[a-zA-Z]/g)].map((m) => m[0]);
  must(
    hits.length === 0,
    `发现 ${hits.length} 处哈希类名：${hits.slice(0, 3).join(', ')}\n` +
      '  ⇒ 哈希随 DSH 构建变化，引用即脆断',
  );
  return '未发现';
});

// ── D. 不得写死颜色 ─────────────────────────────────────────────────────────
check('D. CSS 不含写死的颜色字面量', () => {
  // `mask-image` 里的颜色是**遮罩语法**（只取 alpha），不是主题色，按例放行。
  const withoutMask = liveCss.replace(/(?:-webkit-)?mask-image\s*:\s*[^;]+;/g, '');
  const patterns = [/#[0-9a-fA-F]{3,8}\b/g, /\brgba?\s*\(/g, /\bhsla?\s*\(/g];
  const hits = patterns.flatMap((re) => [...withoutMask.matchAll(re)].map((m) => m[0]));
  must(
    hits.length === 0,
    `发现 ${hits.length} 处颜色字面量：${hits.slice(0, 4).join(', ')}\n` +
      '  ⇒ 一律走官方令牌（--dsw-alias-* / --dsw-specific-*），否则深色主题下会瞎',
  );
  return '未发现';
});

// ── E. 不得声明 animation ───────────────────────────────────────────────────
check('E. CSS 未声明 animation', () => {
  must(
    !/(^|[^-\w])animation\s*[:;]/m.test(liveCss),
    '声明了 animation\n  ⇒ 与官方既有的动效争夺同一属性，结果取决于样式表插入顺序',
  );
  return '未声明';
});

// ── F. 不得覆盖**官方气泡**的几何 ───────────────────────────────────────────
check('F. 未覆盖官方气泡的几何量', () => {
  // 只检查作用于官方元素的规则（选择器含 data-cuf-body）。
  // 按钮是本插件自建的新元素，它的圆角/字号不受这条约束 —— 把两者混在一起
  // 检查会逼着人写一堆无谓的例外，最后规则本身就没人看了。
  const rules = [...liveCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => [m[1].trim(), m[2]])
    .filter(([sel]) => sel.includes('data-cuf-body'));
  must(rules.length > 0, '没找到作用于 data-cuf-body 的规则');

  const geometry = ['height', 'padding-left', 'line-height', 'font-size', 'border-radius', 'padding-top', 'padding-bottom'];
  const hits = [];
  for (const [sel, body] of rules) {
    for (const prop of geometry) {
      if (new RegExp(`(?<!max-)${prop}\\s*:`, 'm').test(body)) hits.push(`${sel} → ${prop}`);
    }
  }
  must(
    hits.length === 0,
    `覆盖了官方几何：${hits.join('; ')}\n` +
      '  ⇒ 这些量被官方算进了 --dsh-content-font-delta（跟随用户字号），覆盖会脱钩',
  );
  return `${rules.length} 条官方元素规则，未覆盖几何`;
});

// ── F2. 折叠只用 max-height，不得用 height ──────────────────────────────────
check('F2. 折叠仅通过 max-height 实现', () => {
  must(
    /max-height\s*:/.test(liveCss),
    '没有 max-height —— 折叠功能没实现？',
  );
  must(
    !/(^|[^-\w])height\s*:/.test(liveCss),
    '用了 height（会把内容裁死）—— 折叠应当用 max-height，让短内容自然撑开',
  );
  return 'max-height only';
});

// ── G. 锚定必须落在稳定语义属性上 ───────────────────────────────────────────
check('G. CSS 只锚定自定义属性与稳定语义属性', () => {
  const selectors = [...liveCss.matchAll(/^([^{@/][^{]*)\{/gm)]
    .map((m) => m[1].trim())
    .filter((s) => s.length > 0);
  must(selectors.length > 0, '没找到任何选择器');
  const allowed = /data-cuf-|data-chat-flow-kind|aria-expanded|focus-visible|:hover/;
  const bad = selectors.filter((s) => !allowed.test(s));
  must(
    bad.length === 0,
    `以下选择器未锚定在允许的属性上：${bad.slice(0, 3).join(' | ')}\n` +
      '  ⇒ 只允许 data-cuf-*（本插件自己的标记）、data-chat-flow-kind、aria-expanded 与状态伪类',
  );
  return `${selectors.length} 条规则全部合规`;
});

// ── H. 属性选择器的值必须带引号 ─────────────────────────────────────────────
check('H. 属性选择器带引号', () => {
  const hits = [...liveCss.matchAll(/\[\s*[\w-]+\s*[~|^$*]?=\s*[^"'\]]/g)];
  must(
    hits.length === 0,
    `发现 ${hits.length} 处未加引号的属性值：${hits.slice(0, 3).map((m) => m[0]).join(', ')}`,
  );
  return '全部带引号';
});

// ── I. JS 里不得出现白名单以外的哈希类名 ────────────────────────────────────
check('I. JS 只允许 _bubble 一个哈希后缀', () => {
  const hits = [...CLIENT.matchAll(/\[class[*^$|~]?=\s*["']([^"']+)["']\]/g)].map((m) => m[1]);
  const bad = hits.filter((v) => v !== '_bubble');
  must(
    bad.length === 0,
    `JS 里出现了白名单外的类名匹配：${bad.join(', ')}\n` +
      '  ⇒ 哈希类名只允许「在 data-chat-flow-kind="user" 范围内」匹配 `_bubble` 这一处',
  );
  return hits.length === 0 ? '未使用类名匹配' : `仅 ${[...new Set(hits)].join(', ')}`;
});

// ── J. 模板字符串内不得含反引号或 ${ ────────────────────────────────────────
check('J. 内联 CSS 不含反引号 / ${', () => {
  must(!inlineCss.includes('`'), '内联 CSS 含反引号 —— 会截断 lib/client.js 的模板字符串');
  must(!inlineCss.includes('${'), '内联 CSS 含 ${ —— 会在模板字符串里被求值');
  return '安全';
});

// ── K. 文件齐备 ─────────────────────────────────────────────────────────────
check('K. 必要文件齐备', () => {
  const need = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'LICENSE'];
  const missing = need.filter((f) => !existsSync(join(ROOT, f)));
  must(missing.length === 0, `缺少：${missing.join(', ')}`);
  return `${need.length} 个文件`;
});

// ── 输出 ────────────────────────────────────────────────────────────────────
for (const line of results) process.stdout.write(line + '\n');
process.stdout.write(
  `\n${results.length - failed}/${results.length} 项通过\n`,
);
process.exit(failed > 0 ? 1 : 0);
