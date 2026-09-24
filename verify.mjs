#!/usr/bin/env node
/**
 * dsh-cute-user-fold · 折叠行为验证（真实浏览器内核）
 *
 * 为什么需要它
 * ============
 * `lint.mjs` 只能做**静态**检查。它无法回答本插件最要紧的问题：
 *
 *   · 选择器到底有没有命中 DSH 的用户消息气泡？
 *   · 折叠高度算得对不对（跟着行高走，而不是硬编码）？
 *   · 点击按钮真的会展开吗？再点会收回去吗？
 *   · **不够长的消息有没有被误伤**（应当零改动）？
 *
 * 这些都必须**跑起来看**。所以这里用真 headless Chromium 复刻 DOM 形状、
 * 真实执行 `lib/client.js`（不是复述它的逻辑）、再读回 `getComputedStyle`
 * 与几何值做断言。推断变成观测。
 *
 * 本脚本**不启动 DSH、不碰 profile、不连 CDP** —— 在独立页面上跑，
 * 随时可执行，不会打断任何正在进行的会话。
 *
 * 用法：node verify.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** 与插件保持一致的策略常量（从 client.js 里读，避免两处漂移）。 */
const CLIENT_SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');

function loadChromium() {
  try {
    globalThis.chromium = require('playwright-core').chromium;
    return true;
  } catch {
    return false;
  }
}

if (!loadChromium()) {
  process.stderr.write(
    '❌ 找不到 playwright-core —— verify.mjs 需要它来起 headless Chromium。\n' +
      '   请先安装开发依赖：\n' +
      '       npm install            # 或： npm i -D playwright-core\n' +
      '   若它装在别处（例如某个共享 node_modules），可用 NODE_PATH 指过去：\n' +
      '       NODE_PATH=<该目录> node verify.mjs\n',
  );
  process.exit(1);
}

// ── 断言框架 ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const lines = [];

function ok(label, detail) {
  passed += 1;
  lines.push(`✅ ${label.padEnd(50)} ${detail ?? ''}`);
}

function bad(label, detail) {
  failed += 1;
  lines.push(`❌ ${label.padEnd(50)} ${detail ?? ''}`);
}

function assert(cond, label, detail) {
  if (cond) ok(label, detail);
  else bad(label, detail);
}

function section(title) {
  lines.push(`\n【${title}】`);
}

// ── 测试页 ──────────────────────────────────────────────────────────────────

/**
 * 复刻 DSH 用户消息的 DOM 形状与**关键样式**。
 *
 * 样式必须逐字贴近官方实测值 —— 插件靠 `getComputedStyle` 量行高，
 * 测试页若给一套假的行高，验出来的就是假结论：
 *   · `line-height: calc(22px + var(--dsh-content-font-delta, 0px))`
 *   · `padding: 10px 16px`
 *   · `white-space: pre-wrap`（用户消息保留换行，长文本因此会撑高）
 *   · 类名用 `TST_<语义>` 形态，模拟 CSS Module 的 `<hash>_<semantic>`
 */
const CSS_FIXTURE = `
  :root { --dsh-content-font-size: 14px; --dsh-content-font-delta: 0px; }
  body { margin: 0; font-family: sans-serif; }

  [data-chat-flow] { display: flex; flex-direction: column; gap: 16px; width: 520px; }

  .TST_userRow { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .TST_userStack { display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
                   min-width: 0; max-width: 82%; }
  .TST_bubble {
    background: #eef; max-width: 100%;
    font-size: var(--dsh-content-font-size, 14px);
    line-height: calc(22px + var(--dsh-content-font-delta, 0px));
    color: #111; white-space: pre-wrap; word-break: break-word;
    border-radius: 22px; padding: 10px 16px;
  }
  /* 与气泡同形的"助手侧"元素：用来验证作用域没有外溢 */
  .TST_assistantBubble { background: #efe; padding: 10px 16px; border-radius: 8px;
    white-space: pre-wrap;
    line-height: calc(22px + var(--dsh-content-font-delta, 0px)); }
`;

/** 生成 N 行的长文本（每行以换行分隔，配合 pre-wrap 自然成行）。 */
function textOfLines(n) {
  return Array.from({ length: n }, (_, i) => `第 ${i + 1} 行内容`).join('\n');
}

function userRow(turn, inner) {
  return `
  <div data-chat-flow-kind="user" data-chat-turn="${turn}" data-chat-flow-key="k${turn}">
    <div class="TST_userRow">
      <div class="TST_userStack">
        <div class="TST_bubble">${inner}</div>
      </div>
    </div>
  </div>`;
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_FIXTURE}</style></head>
<body>
<div data-chat-flow>
  <!-- 助手侧：内含同形 class，用来验证作用域不外溢 -->
  <div data-chat-flow-kind="assistant" data-chat-turn="0">
    <div class="TST_assistantBubble" id="assistantBody">${textOfLines(20)}</div>
  </div>

  <!-- 短的用户消息：应当**完全不被处理** -->
  ${userRow(1, '这是一条短消息\n只有两行')}

  <!-- 长的用户消息：应当被折叠 -->
  ${userRow(2, textOfLines(20))}

  <!-- 更长的用户消息 -->
  ${userRow(3, textOfLines(40))}
</div>
</body></html>`;

// ── 驱动器 ──────────────────────────────────────────────────────────────────

/**
 * 在页面里装一个最小可用的 `__ModuleLoader__`，然后加载真实 bundle。
 *
 * 这不是「模拟插件」，而是**真的执行** `lib/client.js`：它在页面里调用
 * `window.__ModuleLoader__.load({id, factory})`，我们存下 factory 并执行它，
 * 拿到 `exports` 后按 DSH 客户端的做法调用 `apply(ctx)`。
 *
 * ⚠️ 2026-09-24 更正：这里曾断言「`module` / `exports` 由 DSH 的 runner 以
 * **CommonJS 外壳**注入」，并据此用 `new Function('module','exports','require', source)`
 * 把源码包起来执行。**该断言是错的** ——
 * 夹具自己造了外壳，于是 `exports.inject = …` / `return module.exports`
 * 在测试里能跑，真机却抛 `ReferenceError: exports is not defined`，
 * 插件的 bundle **根本无法加载**（重启后整棵插件树报 Failed to load plugins）。
 * 这是典型的**测试替 bug 背书**：夹具比运行时"宽容"，测试永远绿。
 *
 * 真相（`@deepseek-ai/dsh-client-modules/lib/client.js:16-21` 契约注释，逐字）：
 *      factory(require) → exports
 * loader **只注入 `require`**；工厂的**返回值**本身就是模块导出
 * （runner 另会自己补 `name`：`dsh-cordis-client-runner/lib/client.js:613-620`）。
 * 因此这里必须**不提供** `module` / `exports`，否则测不出真问题。
 */
async function bootPlugin(page, src) {
  await page.evaluate((source) => {
    window.__cufLoaded = [];
    window.__cufDisposers = [];
    /**
     * 复刻真实动态 ctx 的最小面。
     *
     * ⚠️ 必须提供 `effect`：本机实测 `ctx.effect` 在真实动态 ctx 上**存在且是
     * 官方约定的清理入口**（runner 的白名单里有 `"effect"`，签名
     * `ctx.effect(callback, label?) => () => void`；官方 ui-conversation 用了 9 次）。
     * 第一版夹具只传 `{}`，于是插件里正确的 `ctx.effect(...)` 直接抛
     * `TypeError: ctx.effect is not a function` —— 那是**夹具与运行时不一致**，不是插件的问题。
     *
     * 这里把 callback 的返回值（disposer）存进 `__cufDisposers`，供"场景 10 · 卸载清理"调用。
     */
    function makeCtx() {
      return {
        effect(callback) {
          const disposer = callback();
          window.__cufDisposers.push(disposer);
          return () => {
            if (typeof disposer === 'function') disposer();
          };
        },
      };
    }
    window.__cufApply = function applyPlugin() {
      const mod = window.__cufLoaded[0];
      if (!mod) throw new Error('bundle 没有调用 __ModuleLoader__.load');
      mod.exports.apply(makeCtx());
      return mod;
    };
    window.__ModuleLoader__ = {
      load(mod) {
        // 按真实 loader 的方式 materialize：**只传 require，取返回值当导出**。
        const res = mod.factory(() => {
          throw new Error('本插件不应有任何 require（零依赖）');
        });
        if (res === null || typeof res !== 'object') {
          throw new Error(
            'factory 必须返回模块导出对象，实测返回 ' + typeof res
            + ' —— 真实 loader 只注入 require，不注入 module/exports（见文件头说明）。',
          );
        }
        window.__cufLoaded.push({ id: mod.id, exports: res });
      },
    };

    // 按**真实 loader** 的方式执行源码：只装好 window.__ModuleLoader__，
    // **不提供** module / exports。
    // 若 bundle 里出现裸 `exports.x = …`，这里会真实地抛
    // `ReferenceError: exports is not defined` —— 与浏览器现场完全一致，
    // 而不会像旧夹具那样被外壳掩盖成"通过"。
    const run = new Function(source);
    run();
  }, src);

  await page.evaluate(() => {
    window.__cufApply();
  });

  await settle(page);
}

/** 等两帧 —— 插件用 requestAnimationFrame 合并扫描。 */
async function settle(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** 读一个元素的关键状态。 */
function probe(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      hasBodyAttr: el.hasAttribute('data-cuf-body'),
      folded: el.hasAttribute('data-cuf-folded'),
      open: el.hasAttribute('data-cuf-open'),
      maxHeight: cs.maxHeight,
      foldVar: el.style.getPropertyValue('--cuf-fold-h'),
      height: Math.round(el.getBoundingClientRect().height),
      scrollHeight: el.scrollHeight,
      text: el.textContent.slice(0, 24),
    };
  }, selector);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const LINE = 22;
const PAD = 20; // padding 10px × 2

/**
 * 两个高度是两个不同的量，别混用（第一版就是混了，被本脚本抓出来）：
 *
 *   CONTENT_H = `max-height` 的取值 —— 官方气泡是 **content-box**，
 *               该属性只限制**内容区**，上下 padding 不计入。
 *   BOX_H     = 渲染出来的**总高度** —— 内容区 + padding。
 *   FOLD_AT   = 触发阈值 —— `scrollHeight` 是含 padding 的，故此处也要含。
 */
const CONTENT_H = 8 * LINE; // 176
const BOX_H = CONTENT_H + PAD; // 196
const FOLD_AT = CONTENT_H + PAD; // 196

const browser = await chromium.launch();
let exitCode = 0;

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  await page.setContent(HTML, { waitUntil: 'load' });
  await bootPlugin(page, CLIENT_SRC);

  // ── 场景 1：足够短的消息必须零改动 ──────────────────────────────────────
  section('场景 1 · 短消息（2 行）—— 必须零改动');

  const short = await probe(page, '[data-chat-turn="1"] .TST_bubble');
  assert(short !== null, '短消息气泡存在');
  assert(!short.hasBodyAttr, '未被标记 data-cuf-body', short.hasBodyAttr ? '被标记了（误伤）' : '正确');
  assert(!short.folded, '未折叠', '正确');
  assert(
    short.maxHeight === 'none',
    '未限制高度',
    `max-height = ${short.maxHeight}`,
  );
  assert(
    (await page.locator('[data-chat-turn="1"] [data-cuf-toggle]').count()) === 0,
    '未插入按钮',
    '正确',
  );

  // ── 场景 2：超长消息必须被折叠 ──────────────────────────────────────────
  section('场景 2 · 长消息（20 行）—— 必须折叠');

  const long = await probe(page, '[data-chat-turn="2"] .TST_bubble');
  assert(long !== null, '长消息气泡存在');
  assert(long.hasBodyAttr, '已标记 data-cuf-body');
  assert(long.folded, '已进入折叠态');
  assert(
    long.foldVar === `${CONTENT_H}px`,
    '折叠高度 = 8 行等效高度（含 padding）',
    `--cuf-fold-h = ${long.foldVar}（期望 ${CONTENT_H}px，仅内容区）`,
  );
  assert(
    long.maxHeight === `${CONTENT_H}px`,
    'max-height 生效',
    `实得 ${long.maxHeight}`,
  );
  assert(
    long.height === BOX_H,
    '渲染高度已被限制',
    `实得 ${long.height}px（期望 ${BOX_H}px = ${CONTENT_H} + padding；自然高 ${long.scrollHeight}px）`,
  );
  assert(
    long.scrollHeight > FOLD_AT,
    '内容确实超出（不是被裁没了）',
    `scrollHeight ${long.scrollHeight} > ${FOLD_AT}`,
  );

  const btn = page.locator('[data-chat-turn="2"] [data-cuf-toggle]');
  assert((await btn.count()) === 1, '插入了 1 个按钮');
  assert(
    (await btn.textContent())?.startsWith('展开'),
    '按钮文案 = 展开',
    (await btn.textContent()) ?? '',
  );
  assert(
    (await btn.getAttribute('aria-expanded')) === 'false',
    'aria-expanded = false',
  );

  // ── 场景 3：点击展开 ────────────────────────────────────────────────────
  section('场景 3 · 点击按钮 —— 应当展开');

  await btn.click();
  await settle(page);

  const opened = await probe(page, '[data-chat-turn="2"] .TST_bubble');
  assert(opened.open, '已标记 data-cuf-open');
  assert(opened.maxHeight === 'none', '高度限制解除', `max-height = ${opened.maxHeight}`);
  assert(
    opened.height > FOLD_AT,
    '内容完整显示',
    `${opened.height}px > ${FOLD_AT}px`,
  );
  assert(
    (await page.locator('[data-chat-turn="2"] [data-cuf-toggle]').textContent())?.startsWith(
      '收起',
    ),
    '按钮文案变为收起',
  );
  assert(
    (await page.locator('[data-chat-turn="2"] [data-cuf-toggle]').getAttribute('aria-expanded')) ===
      'true',
    'aria-expanded = true',
  );

  // ── 场景 4：再点一次收回 ────────────────────────────────────────────────
  section('场景 4 · 再点一次 —— 应当收回');

  await page.locator('[data-chat-turn="2"] [data-cuf-toggle]').click();
  await settle(page);

  const refolded = await probe(page, '[data-chat-turn="2"] .TST_bubble');
  assert(!refolded.open, 'data-cuf-open 已移除');
  assert(
    refolded.maxHeight === `${CONTENT_H}px`,
    '重新受 max-height 限制',
    `实得 ${refolded.maxHeight}`,
  );
  assert(refolded.height === BOX_H, '渲染高度回到折叠值', `实得 ${refolded.height}px（期望 ${BOX_H}px）`);

  // ── 场景 5：作用域不得外溢 ──────────────────────────────────────────────
  section('场景 5 · 助手侧同形元素 —— 必须完全不受影响');

  const assistant = await page.evaluate(() => {
    const el = document.getElementById('assistantBody');
    const cs = getComputedStyle(el);
    return {
      hasBodyAttr: el.hasAttribute('data-cuf-body'),
      maxHeight: cs.maxHeight,
      height: Math.round(el.getBoundingClientRect().height),
      toggles: document.querySelectorAll('[data-chat-turn="0"] [data-cuf-toggle]').length,
    };
  });
  assert(!assistant.hasBodyAttr, '未被标记', '正确');
  assert(assistant.maxHeight === 'none', '未被限制高度');
  assert(assistant.toggles === 0, '未被插入按钮');
  assert(
    assistant.height > FOLD_AT,
    '仍然完整展开（未被误折）',
    `${assistant.height}px`,
  );

  // ── 场景 6：更长的消息各自独立 ──────────────────────────────────────────
  section('场景 6 · 40 行消息 —— 独立折叠、互不干扰');

  const huge = await probe(page, '[data-chat-turn="3"] .TST_bubble');
  assert(huge.folded, '已折叠');
  assert(huge.height === BOX_H, '折叠高度一致', `实得 ${huge.height}px（期望 ${BOX_H}px）`);
  assert(
    (await page.locator('[data-chat-turn="3"] [data-cuf-toggle]').count()) === 1,
    '各自有独立按钮',
  );

  const stillFolded = await probe(page, '[data-chat-turn="2"] .TST_bubble');
  assert(
    !stillFolded.open && stillFolded.height === BOX_H,
    '前一条消息不受影响（仍折叠）',
    `${stillFolded.height}px`,
  );

  // ── 场景 7：流式新增的行必须被自动处理 ──────────────────────────────────
  section('场景 7 · 动态新增消息 —— 观察器自动处理');

  await page.evaluate((html) => {
    const flow = document.querySelector('[data-chat-flow]');
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    flow.appendChild(wrap.firstElementChild);
  }, userRow(4, textOfLines(30)));
  await settle(page);

  const late = await probe(page, '[data-chat-turn="4"] .TST_bubble');
  assert(late !== null, '新增行已渲染');
  assert(late.folded, '新增行被自动折叠');
  assert(
    late.height === BOX_H,
    '折叠高度正确',
    `实得 ${late.height}px（期望 ${BOX_H}px）`,
  );

  // ── 场景 8：幂等（重复 apply 不得重复插按钮）────────────────────────────
  section('场景 8 · 幂等 —— 重复应用不得重复插入');

  await page.evaluate(() => {
    window.__cufApply();
  });
  await settle(page);

  const dupCount = await page.locator('[data-chat-turn="2"] [data-cuf-toggle]').count();
  assert(dupCount === 1, '按钮仍只有 1 个', `实得 ${dupCount}`);
  const styleCount = await page.evaluate(
    () => document.querySelectorAll('style[data-plugin-css]').length,
  );
  assert(styleCount === 1, '样式表仍只有 1 份', `实得 ${styleCount}`);

  // ── 场景 9：跟随用户字号 ────────────────────────────────────────────────
  section('场景 9 · 字号变大 —— 折叠高度必须跟着变，不得硬编码');

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--dsh-content-font-delta', '8px');
  });
  await settle(page);

  const scaled = await page.evaluate(() => {
    const el = document.querySelector('[data-chat-turn="2"] .TST_bubble');
    const cs = getComputedStyle(el);
    return {
      lineHeight: cs.lineHeight,
      maxHeight: cs.maxHeight,
      height: Math.round(el.getBoundingClientRect().height),
      foldVar: el.style.getPropertyValue('--cuf-fold-h'),
    };
  });
  assert(
    Number.parseFloat(scaled.lineHeight) === LINE + 8,
    '行高已随变量变化（夹具本身有效）',
    `line-height = ${scaled.lineHeight}`,
  );
  assert(
    scaled.maxHeight === `${8 * (LINE + 8)}px`,
    'max-height 自动跟随新行高（lh 单位生效）',
    `实得 ${scaled.maxHeight}（期望 ${8 * (LINE + 8)}px，仅内容区）`,
  );
  assert(
    scaled.height === 8 * (LINE + 8) + PAD,
    '渲染高度随之更新',
    `实得 ${scaled.height}px（期望 ${8 * (LINE + 8) + PAD}px = 240 + padding）`,
  );
  assert(
    scaled.foldVar === `${CONTENT_H}px`,
    'JS 兜底值保持原样（设计如此：它只服务于不认 lh 的浏览器）',
    `--cuf-fold-h = ${scaled.foldVar}`,
  );

  // ── 场景 10：卸载清理（本插件第一版缺失的覆盖）──────────────────────────
  // 为什么必须测：清理曾是死代码 —— 用了 `ctx.on('dispose', …)`，但 cordis **没有**
  // `dispose` 事件（实测 emit 0 次），于是卸载时 observer 不断开、样式不移除、
  // `data-cuf-*` 与按钮留在 DOM 里。它当时 40 项全绿，因为**没有任何一项碰清理**。
  section('场景 10 · 卸载清理 —— disposer 必须真的断开与摘净');

  const beforeDispose = await page.evaluate(() => ({
    buttons: document.querySelectorAll('[data-cuf-toggle]').length,
    styles: document.querySelectorAll('style[data-plugin-css]').length,
    seen: document.querySelectorAll('[data-cuf-seen]').length,
  }));

  await page.evaluate(() => {
    for (const dispose of window.__cufDisposers) {
      if (typeof dispose === 'function') dispose();
    }
  });
  await settle(page);

  const afterDispose = await page.evaluate(() => ({
    buttons: document.querySelectorAll('[data-cuf-toggle]').length,
    styles: document.querySelectorAll('style[data-plugin-css]').length,
    marked: document.querySelectorAll('[data-cuf-body],[data-cuf-folded],[data-cuf-open]').length,
    seen: document.querySelectorAll('[data-cuf-seen]').length,
  }));

  assert(
    beforeDispose.buttons >= 1,
    '卸载前确有注入物（否则本场景无效）',
    `按钮=${beforeDispose.buttons} 样式=${beforeDispose.styles} 标记行=${beforeDispose.seen}`,
  );
  assert(afterDispose.buttons === 0, '按钮已全部移除', `实得 ${afterDispose.buttons}`);
  assert(afterDispose.styles === 0, '注入的样式表已移除', `实得 ${afterDispose.styles}`);
  assert(afterDispose.marked === 0, 'data-cuf-body/folded/open 已全部摘除', `实得 ${afterDispose.marked}`);
  assert(afterDispose.seen === 0, 'data-cuf-seen 已摘除（否则重装后会漏处理）', `实得 ${afterDispose.seen}`);

  // 观察器必须真的断开：卸载后再插入长消息，不得再被折叠
  await page.evaluate(() => {
    const stack = document.querySelector('[data-chat-turn="1"]');
    const row = document.createElement('div');
    row.setAttribute('data-chat-flow-kind', 'user');
    row.setAttribute('data-chat-turn', '99');
    row.innerHTML = `<div class="TST_userStack"><div class="TST_bubble">${'卸载后新增的长消息\\n'.repeat(30)}</div></div>`;
    stack?.parentElement?.appendChild(row);
  });
  await settle(page);

  const afterUnloadInsert = await page.evaluate(() => ({
    folded: document.querySelectorAll('[data-chat-turn="99"] [data-cuf-folded]').length,
    buttons: document.querySelectorAll('[data-chat-turn="99"] [data-cuf-toggle]').length,
  }));
  assert(
    afterUnloadInsert.folded === 0 && afterUnloadInsert.buttons === 0,
    '卸载后不再处理新节点（观察器已断开）',
    `折叠=${afterUnloadInsert.folded} 按钮=${afterUnloadInsert.buttons}`,
  );

  // ── 场景 11：短→长（文本节点增长路径）────────────────────────────────────
  // 为什么必须测：曾真实存在双重缺陷 ——
  //   ① 观察器只筛元素节点（nodeType===1），而"内容变长"常表现为 childList 里
  //      新增/替换**文本节点**（nodeType===3）⇒ 这类变动被整类丢掉、永不重扫；
  //   ② 已判"不够长"的行被标 seen 后不再评估。
  // 两者叠加 ⇒ **短消息先渲染、随后变长就永远不折叠**（DSH 里真实可达）。
  // 本场景在真 Chromium 里复现该路径，断言必须折叠。
  section('场景 11 · 短消息随后变长 —— 必须重新评估并折叠');

  // ⚠️ 场景 10 刚把所有实例卸载掉了（那是它的目的）。这里必须先重新挂载，
  // 否则没有观察器在跑，本场景测的就不是"变长能否重评估"，而是"插件不在时会不会工作"。
  await page.evaluate(() => { window.__cufDisposers.length = 0; window.__cufApply(); });
  await settle(page);

  await page.evaluate(() => {
    const stack = document.querySelector('[data-chat-turn="1"]');
    const row = document.createElement('div');
    row.setAttribute('data-chat-flow-kind', 'user');
    row.setAttribute('data-chat-turn', '88');
    row.innerHTML = '<div class="TST_userStack"><div class="TST_bubble" id="grow">短消息只有一行</div></div>';
    stack?.parentElement?.appendChild(row);
  });
  await settle(page);

  const grownBefore = await probe(page, '#grow');
  assert(
    grownBefore !== null && grownBefore.folded === false,
    '变长前不折叠（短消息零改动）',
    `folded=${grownBefore?.folded}`,
  );

  // 只改文本内容 —— 与 DSH 里"异步补全/流式渲染"同形
  await page.evaluate(() => {
    const bubble = document.querySelector('#grow');
    bubble.textContent = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行内容`).join('\n');
  });
  await settle(page);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  const grownAfter = await page.evaluate(() => {
    const bubble = document.querySelector('#grow');
    return {
      folded: bubble?.hasAttribute('data-cuf-folded') ?? false,
      buttons: document.querySelectorAll('[data-chat-turn="88"] [data-cuf-toggle]').length,
      height: Math.round(bubble?.getBoundingClientRect().height ?? 0),
    };
  });
  assert(
    grownAfter.folded && grownAfter.buttons === 1,
    '变长后自动折叠（文本节点增长必须触发重扫）',
    `折叠=${grownAfter.folded} 按钮=${grownAfter.buttons} 高度=${grownAfter.height}px`,
  );

  // ── 场景 12：多实例 —— 卸载其一不得破坏另一个 ────────────────────────────
  // 为什么必须测：曾用模块级共享状态（scheduled/pending/frameId/styleTag），
  // 任一 disposer 会清空另一实例的调度，且先卸载的实例会删掉**不属于自己**的
  // <style>，导致仍在运行的实例失去样式。
  section('场景 12 · 多实例 —— 单独卸载任一实例不得破坏另一个');

  const multi = await page.evaluate(() => {
    window.__cufDisposers.length = 0;
    window.__cufApply();                       // 实例 A
    window.__cufApply();                       // 实例 B
    return { disposeCount: window.__cufDisposers.length };
  });
  await settle(page);
  assert(multi.disposeCount === 2, '两个实例各注册了一个 disposer', `实得 ${multi.disposeCount}`);

  const beforeDisposeOne = await page.evaluate(() => ({
    styles: document.querySelectorAll('style[data-plugin-css]').length,
    buttons: document.querySelectorAll('[data-cuf-toggle]').length,
  }));

  // 只卸载其中一个实例
  await page.evaluate(() => { window.__cufDisposers[0](); });
  await settle(page);

  const afterDisposeOne = await page.evaluate(() => ({
    styles: document.querySelectorAll('style[data-plugin-css]').length,
    buttons: document.querySelectorAll('[data-cuf-toggle]').length,
  }));
  assert(
    afterDisposeOne.styles === 1,
    '卸载其一后样式仍在（不得删掉不属于自己的 <style>）',
    `卸载前 ${beforeDisposeOne.styles} → 卸载后 ${afterDisposeOne.styles}`,
  );

  // 仍在运行的实例必须还能工作：新增一条长消息应当被折叠
  await page.evaluate(() => {
    const stack = document.querySelector('[data-chat-turn="1"]');
    const row = document.createElement('div');
    row.setAttribute('data-chat-flow-kind', 'user');
    row.setAttribute('data-chat-turn', '77');
    row.innerHTML = '<div class="TST_userStack"><div class="TST_bubble">'
      + Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行`).join('\n')
      + '</div></div>';
    stack?.parentElement?.appendChild(row);
  });
  await settle(page);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  const survivorWorks = await page.evaluate(
    () => document.querySelectorAll('[data-chat-turn="77"] [data-cuf-toggle]').length,
  );
  assert(
    survivorWorks === 1,
    '幸存实例仍能折叠新消息',
    `按钮=${survivorWorks}`,
  );

  // ── 输出 ────────────────────────────────────────────────────────────────
  for (const l of lines) process.stdout.write(l + '\n');
  process.stdout.write(`\n${passed}/${passed + failed} 项通过\n`);
  exitCode = failed > 0 ? 1 : 0;
} finally {
  await browser.close();
}

process.exit(exitCode);
