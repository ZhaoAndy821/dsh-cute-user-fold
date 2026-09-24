#!/usr/bin/env node
/**
 * dsh-cute-user-fold · CSS 同步工具
 *
 * 把 `styles/cute-user-fold.css` 原文写进 `lib/client.js` 的 `CSS` 常量。
 *
 * 为什么需要它
 * ============
 * 本插件有**两处 CSS**（可读源码 + 内联副本）：浏览器端 bundle 无法可靠读取
 * 包内相对路径的文件（模块表门禁只放行基线模块），所以内联是必须的；
 * 但两处手工同步极易漂移，而漂移后果是**静默的**（改了源码但浏览器无变化）。
 * `lint.mjs` 负责**发现**漂移，本脚本负责**消除**漂移。
 *
 * 与同类工具的一处刻意不同：**不做压缩**。
 * 本源文件不足百行，压掉的字节对插件体积无实质影响，却会让内联副本
 * 失去可读性 —— 而「一眼能看出两边一致」正是这套双副本机制最需要的性质。
 * 代价是要挡住模板字符串的两个杀手：反引号与 `${`（见下）。
 *
 * 用法：node sync-css.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'styles', 'cute-user-fold.css');
const CLIENT = join(ROOT, 'lib', 'client.js');

const BEGIN = '/* @cuf:css:begin';
/**
 * 结束标记常量。
 *
 * 注意这条注释本身**不能写出注释结束符的字面形态**：那样会把本注释提前
 * 结束掉，后面的文字就变成代码了。与另一端 START 常量同理，两个标记
 * 都必须带注释开头，否则替换时会丢掉注释符号。
 */
const END = '/* @cuf:css:end */';

const source = readFileSync(SRC, 'utf8');

/**
 * 模板字符串安全门。
 *
 * CSS 会被塞进 `const CSS = \`…\`;`。若源码含反引号会**提前截断**该字符串，
 * 含 `${` 会被**求值**（可能抛错，也可能静默产生错误内容）。两者都是
 * 「改一行 CSS 却让整个插件炸掉」的隐蔽故障，所以在写入端直接拦下，
 * 而不是等浏览器里报错。
 */
for (const [bad, why] of [
  ['`', '反引号会截断模板字符串'],
  ['${', '`${` 会在模板字符串里被求值'],
]) {
  if (source.includes(bad)) {
    process.stderr.write(`❌ styles/cute-user-fold.css 含 ${JSON.stringify(bad)}：${why}\n`);
    process.exit(1);
  }
}

const client = readFileSync(CLIENT, 'utf8');

const beginAt = client.indexOf(BEGIN);
const endAt = client.indexOf(END);
if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
  process.stderr.write(`❌ lib/client.js 里找不到 ${BEGIN} … ${END} 标记区间\n`);
  process.exit(1);
}

const bodyStart = client.indexOf('\n', beginAt) + 1;
const replacement = client.slice(0, bodyStart) + source + client.slice(endAt);
const next = replacement;

if (next === client) {
  process.stdout.write('已是最新，无需改动\n');
  process.exit(0);
}

writeFileSync(CLIENT, next, 'utf8');
process.stdout.write(
  `✅ 已同步 styles/cute-user-fold.css → lib/client.js（${source.length} 字符）\n`,
);
