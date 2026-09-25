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

    /** 连续多少次遇到 user 行但气泡无法唯一定位后告警。 */
    const BODY_WARN_AFTER = 3;

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

    /**
     * 在一条 user row 内按 class token 的精确语义后缀找气泡。
     *
     * 只有候选恰好一个时才返回；零个或多个都 fail-closed。
     */
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

      // 幂等闸门：`ATTR_BODY` 既表示"这个元素已被本插件认定"，
      // 也顺带充当"按钮已装过"的标记。
      // 为什么必须有：新的 `handleRow` 允许"内容确实变长后重新评估"，
      // 于是同一条消息可能被评估两次；若无条件 `insertToggle`，就会插出第二个按钮
      // （verify 场景 8「重复应用不得重复插入」实测抓住：按钮实得 2，期望 1）。
      // 注意：卸载时 `cleanupDom` 会摘掉 `ATTR_BODY` 并移除按钮，两者同生共死，
      // 故重装后仍会正常插入。
      if (body.hasAttribute(ATTR_BODY)) return true;

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

    function findUniqueBody(row) {
      let found = null;

      for (const el of row.querySelectorAll('[class*="_bubble"]')) {
        let matched = false;
        for (const token of el.classList) {
          if (token.endsWith('_bubble')) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;

        if (found !== null) return null;
        found = el;
      }

      return found;
    }

    /*
     * 样式和折叠 DOM 是多个 apply() 实例共同使用的资源。
     * 每个实例自己的调度 / 告警状态仍完全隔离；共享资源只在最后一个实例退出时清理。
     */
    let activeInstances = 0;
    let managedStyleTag = null;

    function createState() {
      return {
        invalidBodyStreak: 0,
        invalidBodyWarned: false,
        scheduled: false,
        frameId: 0,
        pending: new Set(),

        // 已判定完成的 row 上次评估时的真实高度；不写入 DOM。
        evaluatedHeight: new WeakMap(),

        // 只记录本插件真正改过 --cuf-fold-h 的元素及其原值。
        foldHeightBefore: new WeakMap(),
        foldHeightTouched: new Set(),
      };
    }

    function noteInvalidBody(state) {
      state.invalidBodyStreak += 1;
      if (!state.invalidBodyWarned && state.invalidBodyStreak >= BODY_WARN_AFTER) {
        state.invalidBodyWarned = true;
        console.warn(
          '[dsh-cute-user-fold] 连续多次无法在 user 行内唯一定位气泡，已跳过这些消息。',
        );
      }
    }

    function hasInlineProperty(style, name) {
      for (let i = 0; i < style.length; i += 1) {
        if (style.item(i) === name) return true;
      }
      return false;
    }

    function restoreFoldHeights(state) {
      for (const el of state.foldHeightTouched) {
        const previous = state.foldHeightBefore.get(el);
        if (previous === undefined) continue;

        if (previous.existed) {
          el.style.setProperty('--cuf-fold-h', previous.value, previous.priority);
        } else {
          el.style.removeProperty('--cuf-fold-h');
        }
      }

      state.foldHeightTouched.clear();
    }

    function handleRow(state, row) {
      if (row.hasAttribute(ATTR_FOLDED)) return;

      const currentHeight = row.scrollHeight;

      if (row.hasAttribute(ATTR_SEEN)) {
        const previousHeight = state.evaluatedHeight.get(row);
        if (previousHeight === currentHeight) return;

        // 只允许内容确实增长后重新评估；缩短或纯布局波动不触发自激重排。
        if (previousHeight !== undefined && currentHeight <= previousHeight) {
          state.evaluatedHeight.set(row, currentHeight);
          return;
        }
      }

      const body = findUniqueBody(row);
      if (body === null) {
        noteInvalidBody(state);
        return; // 内容还没渲染出来或气泡不唯一 —— 留给下次扫描，不标记
      }

      state.invalidBodyStreak = 0;

      const wasFolded = row.hasAttribute(ATTR_FOLDED);
      const hadFoldHeight = hasInlineProperty(body.style, '--cuf-fold-h');
      const oldFoldHeight = body.style.getPropertyValue('--cuf-fold-h');
      const oldFoldPriority = body.style.getPropertyPriority('--cuf-fold-h');

      const handled = consider(row, body);

      if (!wasFolded && row.hasAttribute(ATTR_FOLDED)) {
        if (!state.foldHeightBefore.has(body)) {
          state.foldHeightBefore.set(body, {
            existed: hadFoldHeight,
            value: oldFoldHeight,
            priority: oldFoldPriority,
          });
          state.foldHeightTouched.add(body);
        }
      }

      if (handled) {
        row.setAttribute(ATTR_SEEN, '');

        /*
         * 记录"本次评估之前"的高度，避免 consider() 自己造成的 DOM/CSS 改动
         * 立刻把同一 row 判成"内容增长"而形成评估自激循环。
         */
        state.evaluatedHeight.set(row, currentHeight);
      }
    }

    function scan(state, root) {
      if (root?.nodeType !== 1) return;

      const rows = new Set();

      // React 可能只替换 row 内部节点：先向上归一到所属 user row。
      const ownerRow = root.closest?.(SEL_ROW);
      if (ownerRow !== null && ownerRow !== undefined) rows.add(ownerRow);

      // node 自身就是 user row 时也处理。
      if (root.matches?.(SEL_ROW)) rows.add(root);

      // 同时处理 node 后代中新出现的 user row。
      for (const row of root.querySelectorAll?.(SEL_ROW) ?? []) rows.add(row);

      // Set 先去重，保证同一 row 每次扫描最多处理一次。
      for (const row of rows) handleRow(state, row);
    }

    // ── 观察 ──────────────────────────────────────────────────────────────

    /** 合并同一帧内的多次回调 —— 流式输出时 DOM 变动极频繁。 */
    function flush(state) {
      state.scheduled = false;
      state.frameId = 0;

      const targets = [...state.pending];
      state.pending.clear();

      for (const t of targets) {
        if (!t?.isConnected) continue;
        scan(state, t);
      }
    }

    function schedule(state, target) {
      if (target?.nodeType !== 1) return;

      state.pending.add(target);
      if (state.scheduled) return;

      state.scheduled = true;
      state.frameId = requestAnimationFrame(() => flush(state));
    }

    function observe(state) {
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          /*
           * ⚠️ 这里**不能**只筛元素节点（`nodeType === 1`）。
           *
           * 实测（2026-09-24，真 Chromium 插桩）：把气泡的文本从 1 行改成 30 行时，
           * 浏览器产生的是 **childList 里新增/替换文本节点（nodeType === 3）**，
           * 只筛元素会把这类变动**整类丢掉** ⇒ 永不重扫 ⇒ 「短消息先渲染、随后变长」
           * 永远不折叠（`row.scrollHeight` 已从 42 涨到 680，插件却毫无反应）。
           * React 替换文本、流式追加文本都会走这条路径。
           *
           * 因此：元素节点直接调度；**非元素节点（文本等）改为调度其父元素**。
           */
          for (const node of r.addedNodes) {
            if (node.nodeType === 1) schedule(state, node);
            else schedule(state, node.parentElement ?? r.target.parentElement);
          }

          // 内容被就地改写（React 复用文本节点）时也要重扫
          if (r.type === 'characterData') {
            schedule(state, r.target.parentElement);
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
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
     *
     * 样式属于当前 factory 的共享运行时资源，而不是某个 apply() 实例；
     * 最后一个实例退出时才移除由本 factory 创建的节点。
     */
    function injectStyle() {
      if (typeof document === 'undefined') return null;

      if (managedStyleTag?.isConnected) return managedStyleTag;

      const existing = document.querySelector(
        `style[data-plugin-css="${STYLE_TAG_ID}"]`,
      );
      if (existing !== null) {
        managedStyleTag = null;
        return null;
      }

      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-cute-user-fold';
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);

      managedStyleTag = tag;
      return tag;
    }

    function cleanupDom(state) {
      for (const btn of document.querySelectorAll(`[${ATTR_TOGGLE}]`)) {
        btn.remove();
      }

      for (const el of document.querySelectorAll(
        `[${ATTR_BODY}], [${ATTR_FOLDED}], [${ATTR_OPEN}]`,
      )) {
        el.removeAttribute(ATTR_BODY);
        el.removeAttribute(ATTR_FOLDED);
        el.removeAttribute(ATTR_OPEN);
      }

      restoreFoldHeights(state);

      for (const row of document.querySelectorAll(`[${ATTR_SEEN}]`)) {
        row.removeAttribute(ATTR_SEEN);
      }
    }

    // ── 入口 ──────────────────────────────────────────────────────────────

    /**
     * 插件入口。
     *
     * @param {object} ctx cordis 上下文。本插件不注入任何服务（见下文
     *   `exports.inject` 的说明）。
     */
    function apply(ctx) {
      if (typeof document === 'undefined') return;

      ctx.effect(() => {
        const state = createState();

        activeInstances += 1;
        injectStyle();

        // 首屏：已经渲染出来的会话
        scan(state, document.body);

        // 后续：流式新增、历史加载、会话切换
        const observer = observe(state);

        return () => {
          observer.disconnect();

          if (state.frameId !== 0) {
            cancelAnimationFrame(state.frameId);
          }
          state.frameId = 0;
          state.scheduled = false;
          state.pending.clear();

          state.invalidBodyStreak = 0;
          state.invalidBodyWarned = false;

          activeInstances = Math.max(0, activeInstances - 1);

          /*
           * 折叠 DOM 与幂等样式由仍存活的实例共同使用。
           * 只有最后一个实例退出时才清理，避免一个 disposer 破坏另一个实例。
           */
          if (activeInstances === 0) {
            cleanupDom(state);

            if (managedStyleTag?.isConnected) {
              managedStyleTag.remove();
            }
            managedStyleTag = null;
          }
        };
      }, 'dsh-cute-user-fold');
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
    const EXPORTS = {
      /** cordis 服务键列表（不是包名列表 —— 见上方说明）。本插件零依赖，故为空。 */
      inject: [],
      apply
    };

    /**
     * ⚠️ 2026-09-24 修正：这里曾是
     *       exports.inject = [];  exports.apply = apply;  … return module.exports;
     *   **协议不支持这种写法**。浏览器侧实测报
     *       failed to import loader entry … : exports is not defined
     *   **整棵插件树加载失败**（本机重启后复现；同类问题在 `dsh-cute-reasoning-skin`
     *   上一并出现）。
     *
     * 原因（`dsh-client-modules/lib/client.js:16-21` 的契约注释，逐字）：
     *      factory(require) → exports
     *   **工厂的返回值本身就是模块导出**；loader **只注入 `require`**，
     *   **不注入 `module` / `exports`**。所以写 `exports.x = …` 必然 ReferenceError。
     *   （runner 另外会自己补 `name` —— `dsh-cordis-client-runner/lib/client.js:613-620`
     *     `return { ...plugin, name: moduleIdOf(pkg.pluginId), apply: … }` ——
     *     它只硬要求返回对象里有 `apply`。）
     *
     * ⚠️ 顺带更正 `verify.mjs` 里的一处错误论断：那里曾写「这两个名字由 DSH 的 runner
     *   以 **CommonJS 外壳**注入」，并据此用 `new Function('module','exports',…)`
     *   把源码包起来执行。**runner 并不注入外壳** ——
     *   是夹具自己造了一个，于是测试全绿而真机必挂（典型的"测试替 bug 背书"）。
     *   该夹具已同步改为按真实方式注入。
     *
     * 正解 = 直接返回对象字面量。本机有第三方插件就是这么写的 ——
     * 其 bundle 末尾形如 `return { name, apply }`（本机实测能在 WebUI 中激活）。
     */

    /**
     * ── 关于 `Config`：本模块**刻意不导出** ────────────────────────────────
     *
     * cordis 的 `resolveConfig`（`@deepseek-ai/cordis/lib/index.js:955-961`）只在
     * `runtime.Config` **是真值**时才要求它是 Standard Schema
     * （`Config["~standard"].validate(config)`）；不导出则原样返回 patch 里的 config。
     * 本插件没有可调参数（折叠行数与按钮文案都是内置常量），故不需要 schema。
     *
     * ⚠️ 若将来要加配置项：**要么不导出**（缺省值在 `apply` 内补），
     *    **要么给出真正的 Standard Schema**（须带 `~standard.validate`）。
     *    导出「能把 config 补全的普通函数」会当场抛
     *    `Cannot read properties of undefined (reading 'validate')`，
     *    整棵插件树加载失败（本机实证）。
     *
     * 也**不引** `@deepseek-ai/schemastery`：它不在浏览器平台基线模块表里，
     * 跨包取值会被模块表门禁拦下。零依赖是这里唯一稳的选择。
     */
    return EXPORTS;
  },
});
