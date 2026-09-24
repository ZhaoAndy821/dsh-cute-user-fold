/**
 * dsh-cute-user-fold · 客户端 bundle（browser half）
 *
 * ⚠️ 本文件**不是普通 ESM 模块** —— 它必须包在 DSH 的客户端模块协议里：
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 *
 * ── id 取值：必须是**包名** ─────────────────────────────────────────────────
 * `__ModuleLoader__.load({ id })` 的 `id` = 本包 `package.json` 的 `name`。
 * 它与 `cordis.patch.yml` 的 patch 行 `id` 是**两个独立命名空间**，不要混同。
 *
 * 依据（本机一手取证）：
 *   - host 侧 `@deepseek-ai/dsh-client-modules/lib/index.js:826`
 *       `entry: graphRow(packageName, rev, source.meta)`  ⇒ `entry.id` 恒为包名
 *   - 同包 `lib/client.js:236-248`：取 `row.id` 后查 `this.factories.has(id)`，
 *     缺了就抛 `bundle … loaded without registering "<id>"`
 *
 * ⚠️ 写错的后果是**硬失败**：WebUI 弹 `Failed to load plugins`，
 *    **整棵插件树加载失败**（不是"样式静默不生效"）。
 *
 * ── 本插件做什么 ───────────────────────────────────────────────────────────
 * 会话里过长的**用户消息**会被收起来，只留前若干行 + 一个「展开」按钮。
 * DSH 默认把用户请求完整铺开（气泡 `white-space: pre-wrap`，粘贴长文本
 * 会撑出几十行），长会话因此变得臃肿。
 *
 * ── 为什么这个插件必须带 JS（而本机那枚皮肤是纯 CSS）──────────────────────
 * 「折叠」这件事有两个纯 CSS 做不到的动作：
 *   1. **按内容长度决定要不要折叠** —— CSS 无法测量实际高度；
 *   2. **点击展开** —— CSS 没有点击状态（checkbox hack 需要官方配合）。
 * 所以本插件走「JS 打标记 + CSS 呈现」：JS 只做测量与打标记，
 * 所有视觉都在样式表里，CSS 侧**不引用任何构建哈希类名**。
 *
 * ── 锚定依据（2026-09-24 本机实测）────────────────────────────────────────
 *   · **稳定**：消息行带 `data-chat-flow-kind="user"`（官方自己的 CSS 就在用
 *     这个属性，见 `dsh-client-ui-chat/lib/client.js`）⇒ 可用。
 *   · **不稳定**：气泡内容只有构建哈希类名（`Sixlwa_bubble`），组件上的
 *     `data-*` 又全是条件性的（`data-message-attachments` / `data-pending-steering`
 *     / `data-submission-echo`）⇒ 无法纯靠属性锚定内容。
 *
 *   因此 JS 在 `[data-chat-flow-kind="user"]` **限定范围内**用 `[class*="_bubble"]`
 *   定位内容（只依赖 CSS Module 的语义后缀，范围已被锁死，误伤风险低），
 *   随即打上**本插件自己的属性**；此后 CSS 只认自己的属性。
 */

window.__ModuleLoader__.load({
  id: 'dsh-cute-user-fold',
  factory: (require) => {
    // ───────────────────────── 插件正文 ─────────────────────────

    /** 内联样式表 —— 由 `sync-css.mjs` 从 `styles/cute-user-fold.css` 同步。
     *  **不要手改这一段**：改源码文件然后跑 `npm run sync-css`。 */
    const CSS = `/* @cuf:css:begin — 由 sync-css.mjs 同步，勿手改 */
/* ============================================================================
 * dsh-cute-user-fold · 样式源码
 *
 * 作用：折叠会话里**过长的用户消息**，点击按钮展开。
 *
 * ── 锚定策略（2026-09-24 实测取证）────────────────────────────────────────
 * 折叠**只作用于 JS 打过标记的元素**，本文件**不引用任何构建哈希类名**
 * （如 「Sixlwa_bubble」）—— 哈希随 DSH 构建变化，引用即脆断。
 *
 *   [data-cuf-body]     JS 找到并标记的「用户消息内容元素」
 *   [data-cuf-folded]   当前处于折叠态
 *   [data-cuf-open]     用户点了展开
 *   [data-cuf-toggle]   展开/收起按钮
 *
 * 之所以能用 JS 打标记：用户消息行本身带官方自用的稳定属性
 * 「[data-chat-flow-kind="user"]」（DSH 自己的 CSS 就在用它），
 * 但气泡内容只有哈希类名、且组件上的 data 属性全是条件性的 ——
 * 详见 docs/DOM-FORENSICS.md。
 *
 * ── 几何纪律（继承本机皮肤插件的一组硬约束）─────────────────────────────
 * · **不碰** 「padding」 / 「line-height」 / 「font-size」 / 「border-radius」；
 * · 唯一改动的高度是 「max-height」（折叠这件事本身）；
 * · 未超长的消息**完全不产生任何 DOM 或样式变化**。
 *
 * ── 配色纪律 ─────────────────────────────────────────────────────────────
 * 全部走官方设计令牌，**零颜色字面量**（lint D 项会拦截）。
 * 按钮是「面」⇒ 用 「--dsw-alias-interactive-bg-*」（半透明叠加色）；
 * 文字 ⇒ 用 「--dsw-alias-label-*」。深浅色由令牌自动兜住。
 * ========================================================================= */

/* ── 1. 折叠本体 ─────────────────────────────────────────────────────────
 * 折叠高度由 JS 按「保留行数 × 实际行高 + 上下 padding」算好，写进
 * 「--cuf-fold-h」。用变量而非硬编码 px，是为了跟随用户字号设置
 * （官方把字号差量放在 「--dsh-content-font-delta」，行高随之变化）。
 * ---------------------------------------------------------------------- */
[data-cuf-body][data-cuf-folded]:not([data-cuf-open]) {
  /* ① 兜底：JS 按当前字号算好的「8 行**内容**高度」（写进 --cuf-fold-h） */
  max-height: var(--cuf-fold-h, 176px);
  /* ② 增强：lh 单位直接引用元素自身的行高 —— 用户在会话进行中改字号时，
     浏览器自己重算，不需要 JS 再跑一遍。若浏览器不认 lh 单位，②整条被
     丢弃、①自动生效；认的话②覆盖①。*/
  max-height: calc(8lh);

  /* ⚠️ 这里**不含 padding**：官方气泡是 content-box（未声明 box-sizing），
     「max-height」 只限制内容区，上下 padding 会额外加在外层。
     第一版把 padding 算进来，结果每条折叠消息都高出 20px —— 是
     「verify.mjs」 用真实浏览器量出来的，光读代码推不出来。 */

  overflow: hidden;

  /* 底部渐隐：用 mask 而不是伪元素 —— 不占用任何伪元素槽位，
     也不会在气泡里插入会影响布局的盒子。 */
  -webkit-mask-image: linear-gradient(
    to bottom,
    #000 0,
    #000 calc(100% - 40px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    #000 0,
    #000 calc(100% - 40px),
    transparent 100%
  );
}

/* ── 2. 展开态 ───────────────────────────────────────────────────────────
 * 展开后完全恢复：不限高、无遮罩。保留 「data-cuf-folded」 属性作为
 * 「这条消息曾因过长被折叠」的事实记录，靠 「:not([data-cuf-open])」 让位。
 * ---------------------------------------------------------------------- */
[data-cuf-body][data-cuf-open] {
  max-height: none;
  -webkit-mask-image: none;
  mask-image: none;
}

/* ── 3. 展开/收起按钮 ────────────────────────────────────────────────────
 * 只由 JS 插入到「确实超长」的消息上；未超长的消息没有这个元素。
 * 「align-self: flex-end」 让它贴右侧 —— 父级 「userStack」 是 column flex
 * 且 「align-items: flex-end」，用户消息本来就右对齐。
 * ---------------------------------------------------------------------- */
[data-cuf-toggle] {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  /* 与气泡之间的视觉间距：父级 flex gap 已经给了 8px，这里收一点，
     让按钮在视觉上「附着」于气泡而不是浮在远处。 */
  margin-top: -4px;

  padding: 2px 10px;
  border: none;
  border-radius: 999px;

  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);

  font-family: inherit;
  font-size: 12px;
  line-height: 20px;

  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

[data-cuf-toggle]:hover {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

[data-cuf-toggle]:focus-visible {
  outline: 2px solid var(--dsw-alias-interactive-bg-active);
  outline-offset: 2px;
}

/* 按钮内的小箭头：展开时朝上、折叠时朝下。用纯字符 + 旋转实现，
   不引入图标依赖。 */
[data-cuf-toggle]::after {
  content: "▾";
  font-size: 10px;
  line-height: 1;
  transform: translateY(-1px);
  transition: transform 120ms ease;
}

[data-cuf-toggle][aria-expanded="true"]::after {
  transform: translateY(1px) rotate(180deg);
}
/* @cuf:css:end */`;

    const STYLE_TAG_ID = 'dsh-cute-user-fold/cute-user-fold.css';

    // ── 标记属性（全部是自定义属性，与官方属性互不干扰）──────────────────
    const ATTR_BODY = 'data-cuf-body';     // 被 JS 认定并标记的内容元素
    const ATTR_FOLDED = 'data-cuf-folded'; // 处于折叠态
    const ATTR_OPEN = 'data-cuf-open';     // 用户点了展开
    const ATTR_TOGGLE = 'data-cuf-toggle'; // 展开/收起按钮
    const ATTR_SEEN = 'data-cuf-seen';     // 已处理过（防重复插入按钮）

    // ── 选择器 ────────────────────────────────────────────────────────────
    /** 用户消息行：官方自用的稳定语义属性。 */
    const SEL_ROW = '[data-chat-flow-kind="user"]';
    /** 气泡内容：只用 CSS Module 的语义后缀，且始终在 SEL_ROW 范围内查询。 */
    const SEL_BODY = '[class*="_bubble"]';
    /** 会话滚动容器，用于挂 observer（缩小观察范围）。 */
    const SEL_FLOW = '[data-chat-flow]';

    // ── 折叠策略 ──────────────────────────────────────────────────────────
    /** 超过这个行数才折叠。8 行 ≈ 176px（14px 字号 / 22px 行高时）。 */
    const FOLD_AFTER_LINES = 8;
    /** 折叠后保留的高度就取「8 行的等效高度」，即 `max-height` 的上限。 */
    const COLLAPSED_LINES = 8;

    const LABEL_FOLDED = '展开';
    const LABEL_OPEN = '收起';

    /** 兜底行高（官方 bubble 为 `calc(22px + --dsh-content-font-delta)`）。 */
    const FALLBACK_LINE_HEIGHT = 22;

    // ── 工具 ──────────────────────────────────────────────────────────────

    function px(value, fallback) {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : fallback;
    }

    /**
     * 量出这只气泡的排版尺度。
     *
     * 不硬编码 px 是刻意的：官方把字号差量放进 `--dsh-content-font-delta`
     * （`line-height: calc(22px + delta)`），用户改字号时行高随之变化，
     * 硬编码会让折叠位置错位。
     *
     * 一次 `getComputedStyle` 同时取三个量 —— 分开取会重复触发样式解析。
     *
     * @returns {{lineHeight: number, pad: number}} 行高，以及上下 padding 之和。
     */
    function measure(body) {
      const cs = getComputedStyle(body);
      return {
        lineHeight: px(cs.lineHeight, FALLBACK_LINE_HEIGHT),
        pad: px(cs.paddingTop, 0) + px(cs.paddingBottom, 0),
      };
    }

    // ── 折叠 ──────────────────────────────────────────────────────────────

    /**
     * 判断一条用户消息是否值得折叠，需要则折叠并装按钮。
     *
     * 注意：**不够长的消息到此为止** —— 不写属性、不插节点、不加样式，
     * 它与插件不存在时**完全一致**。
     */
    function consider(row, body) {
      // 元素必须已布局，否则 scrollHeight 量不准（观察器回调时可能还没排完）。
      if (body.offsetParent === null && body.getClientRects().length === 0) return false;

      const { lineHeight, pad } = measure(body);

      // 触发判断：`scrollHeight` 是**含 padding** 的（它是"内容盒 + 内边距"），
      // 所以这里的阈值也要含 padding，否则短消息会被误判为超长。
      const foldAt = Math.round(FOLD_AFTER_LINES * lineHeight + pad);
      if (body.scrollHeight <= foldAt) return true; // 不够长 —— 到此为止，一点都不碰

      // 折叠高度：**只算内容区**，不含 padding。
      // 官方气泡没有声明 `box-sizing`，即 content-box —— `max-height` 限制的是
      // 内容高度，上下 padding 会额外加在外层。第一版把 padding 也算了进来，
      // 结果每条折叠消息都高出 20px；是 verify.mjs 用真实浏览器量出来的。
      body.style.setProperty(
        '--cuf-fold-h',
        `${Math.round(COLLAPSED_LINES * lineHeight)}px`,
      );

      body.setAttribute(ATTR_BODY, '');
      body.setAttribute(ATTR_FOLDED, '');

      insertToggle(body);
      return true;
    }

    function insertToggle(body) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute(ATTR_TOGGLE, '');
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = LABEL_FOLDED;
      btn.addEventListener('click', () => {
        const isOpen = body.hasAttribute(ATTR_OPEN);
        if (isOpen) {
          body.removeAttribute(ATTR_OPEN);
          btn.setAttribute('aria-expanded', 'false');
          btn.textContent = LABEL_FOLDED;
        } else {
          body.setAttribute(ATTR_OPEN, '');
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = LABEL_OPEN;
        }
      });
      body.after(btn);
    }

    // ── 扫描 ──────────────────────────────────────────────────────────────

    function handleRow(row) {
      if (row.hasAttribute(ATTR_SEEN)) return;
      const body = row.querySelector(SEL_BODY);
      if (body === null) return; // 内容还没渲染出来 —— 留给下次扫描，不标记
      if (consider(row, body)) row.setAttribute(ATTR_SEEN, '');
    }

    function scan(root) {
      if (root.nodeType === 1 && root.matches?.(SEL_ROW)) handleRow(root);
      for (const row of root.querySelectorAll?.(SEL_ROW) ?? []) handleRow(row);
    }

    // ── 观察 ──────────────────────────────────────────────────────────────

    /** 合并同一帧内的多次回调 —— 流式输出时 DOM 变动极频繁。 */
    let scheduled = false;
    const pending = new Set();

    function flush() {
      scheduled = false;
      const targets = [...pending];
      pending.clear();
      for (const t of targets) {
        if (!t.isConnected) continue;
        scan(t);
      }
    }

    function schedule(target) {
      pending.add(target);
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flush);
    }

    function observe() {
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.addedNodes) {
            if (node.nodeType === 1) schedule(node);
          }
          // 内容被就地改写（例如 React 复用了行）时也要重扫
          if (r.type === 'characterData') schedule(r.target.parentElement);
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      return observer;
    }

    // ── 注入 ──────────────────────────────────────────────────────────────

    /**
     * 注入样式表。
     *
     * `data-plugin-css` 是**幂等键**：插件被重复加载时靠它去重，否则会插入
     * 多份样式（内容相同无害，但污染 DOM、妨碍调试）。`data-plugin` 是归属
     * 标记，让 DevTools 里一眼看出这段样式是谁注入的。官方主题系统也读
     * `data-plugin-css`，保持一致更安全。
     */
    function injectStyle() {
      if (typeof document === 'undefined') return;
      if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-cute-user-fold';
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ── 入口 ──────────────────────────────────────────────────────────────

    /**
     * 插件入口。
     *
     * @param {object} ctx cordis 上下文。本插件不注入任何服务（见下文
     *   `exports.inject` 的说明），因此不使用 ctx 的任何字段。
     */
    function apply(ctx) {
      if (typeof document === 'undefined') return;

      injectStyle();

      // 首屏：已经渲染出来的会话
      scan(document.body);

      // 后续：流式新增、历史加载、会话切换
      const observer = observe();

      ctx?.on?.('dispose', () => {
        observer.disconnect();
      });
    }

    /**
     * ── 关于 `exports.inject`（本机最容易踩的协议坑）──────────────────────
     *
     * 字段名相同，但两处 `inject` **语义完全不同**：
     *
     *   · `package.json` 的 `dsh.client.inject` = **包名列表**（供浏览器 loader
     *     做预取 / 依赖图）。本插件无需预取，故为 `[]`。
     *
     *   · 本文件（bundle 内）的 `exports.inject` = **cordis 服务键列表**，
     *     决定 `ctx.<key>` 能否访问。客户端 runner 拿
     *     `Object.keys(ctx.fiber.inject)` 与 ctx 上的属性名逐个比对。
     *
     * ⚠️ 若把**包名**填进 `exports.inject`，fiber 会永远等一个**不存在的服务**，
     *    插件**静默失效**（不报错、样式不出现）。
     *
     * ⇒ 本插件是**零服务依赖**的样式注入 + DOM 标记，故必须写成 `[]`。
     */
    exports.inject = [];
    exports.apply = apply;

    /**
     * ── 关于 `exports.Config`：本插件**刻意不导出** ─────────────────────────
     *
     * cordis 的 `validateConfig` 在 runtime 没有 schema 时把 config 原样返回，
     * 所以不导出 schema 是安全的。本插件没有可调参数（折叠行数与按钮文案
     * 都是内置常量），故不需要。
     *
     * 也**不引** `@deepseek-ai/schemastery`：它不在浏览器平台基线模块表里，
     * 跨包取值会被模块表门禁拦下。零依赖是这里唯一稳的选择。
     */

    return module.exports;
  },
});
