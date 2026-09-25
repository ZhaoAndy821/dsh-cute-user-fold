# dsh-cute-user-fold

折叠 DSH 会话里**过长的用户消息** —— 超过 8 行的收起来，只留 8 行 + 一个「展开」按钮。

DSH 默认把用户请求完整铺开（气泡是 `white-space: pre-wrap`，粘一段长文本就能撑出几十行），
长会话因此变得臃肿。本插件让这类消息默认收起，点击展开、再点收起。

## 安装

```bash
dsh plugin --profile web add <本包路径>
```

装完**重启该 profile** 才生效（配置在启动时读入）。

卸载：

```bash
dsh plugin --profile web remove dsh-cute-user-fold
```

## 行为

| 情况 | 表现 |
|---|---|
| 消息 ≤ 8 行 | **完全不动** —— 不加属性、不插节点、不影响任何样式 |
| 消息 > 8 行 | 收起为 8 行，底部渐隐，下方出现「展开」按钮 |
| 点击「展开」 | 完整显示，按钮变「收起」 |
| 点击「收起」 | 回到 8 行 |
| 流式新增的消息 | 由观察器自动处理，无需刷新 |
| 助手侧的消息 | **不受影响**（作用域限定在 `data-chat-flow-kind="user"`） |

用户中途改字号时，折叠高度会自动跟随行高，无需重启。

## 工作原理

「折叠」有两个纯 CSS 做不到的动作：**按内容长度决定要不要折叠**（CSS 无法测量高度）、
**点击展开**（CSS 没有点击状态）。所以本插件是 **JS 打标记 + CSS 呈现**：

```
JS：在 [data-chat-flow-kind="user"] 范围内找到气泡 → 量高度 → 超长则打标记 + 插按钮
CSS：只认自己的 data-cuf-* 属性，负责视觉呈现
```

**JS 侧唯一一次触碰构建哈希类名**是在 `data-chat-flow-kind="user"` 限定范围内匹配
`[class*="_bubble"]`（只用 CSS Module 的**语义后缀**，不用哈希前缀）；此后一律只认本插件
自己的属性。这是经过取舍的：气泡内容没有任何无条件的官方语义属性可用，
详见 [docs/DOM-FORENSICS.md](docs/DOM-FORENSICS.md)。

## 自检

```bash
npm install          # 开发依赖：playwright-core（仅测试用，已精确锁版本）
npm test             # = lint + verify
```

- **`lint.mjs`（13 项）** —— 静态约束。检查两处 CSS 副本是否一致、注册键是否等于包名、
  有无引用构建哈希类名、有无写死颜色、有无覆盖官方几何等。
- **`verify.mjs`（51 项）** —— 真 headless Chromium 里复刻 DOM、**真实执行** `lib/client.js`，
  断言折叠/展开/误伤/幂等/字号跟随等行为。

> `verify.mjs` 抓出过一个光读代码发现不了的真实缺陷：`max-height` 在 `content-box` 下
> **只限制内容区**，上下 padding 额外加在外层 —— 第一版把 padding 算进 max-height，
> 每条折叠消息都高出 20px。

## 已知限制

- **依赖 `[class*="_bubble"]` 这一处语义后缀**。DSH 若改动该 CSS Module 的命名，
  插件会静默停止工作（不报错、不折叠）。这是当前可用的最稳锚点，详见取证文档。
- 只折叠**用户消息**。折叠回合/工具/思考块不在范围内。
- 折叠状态不跨会话持久化：刷新后回到默认折叠。

## 许可

MIT
