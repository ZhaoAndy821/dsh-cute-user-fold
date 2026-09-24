# DOM 取证报告

本插件的锚点选择全部来自**对本机 DSH 产物的实测**，不是从源码风格或命名习惯推断的。
本文件记录取证过程与结论，便于日后 DSH 升级导致失效时快速定位。

取证日期：2026-09-24 ｜ 目标版本：DSH `0.1.5-rc.2`

## 一、要回答的问题

「折叠用户消息」需要两个锚点：

1. **哪一行是用户消息？** —— 用来限定作用范围，避免误伤助手侧内容。
2. **哪一块是气泡内容？** —— 折叠与展开要作用在它身上。

## 二、取证方法

在 DSH 安装目录的 `@deepseek-ai/` 下定向搜索（**不做整目录递归**，避免软链环）：

```bash
# 找候选包：哪些包在渲染消息
grep -rl "data-chat-flow" node_modules/@deepseek-ai/*/lib/*.js

# 提取某包内全部 data-* 语义属性，看有哪些可锚定
# 读组件定义，确认 DOM 结构与属性取值
```

结论全部来自**源码里的 JSX 构造**（`react_jsx_runtime.jsx(...)` 调用），
即「运行时真正会生成的元素与其属性」，而非文档或注释。

## 三、关键发现

### 3.1 消息行：有稳定的官方语义属性 ✅

`@deepseek-ai/dsh-client-ui-chat/lib/client.js` 中，每个消息行渲染为：

```jsx
jsx("div", {
  className: ChatView_module_css_default.flowItem,
  "data-chat-anchor-key": routedNode.key,
  "data-chat-flow-key":   routedNode.key,
  "data-chat-flow-kind":  routedNode.kind,   // ← 关键
  "data-chat-turn":       turn,
  "data-turn-process-member": processMember || void 0,
  "data-turn-process-hidden": processHidden || void 0,
  "data-turn-process-answer": compactAnswer || void 0,
  children: renderSlot("conversation.chat.node", ...)
})
```

`kind` 的实测取值集合：`user` / `steering` / `context` / `assistant`。

**决定性证据**：官方**自己的 CSS** 就在使用这个属性 ——

```css
:is([data-chat-flow-kind=user],[data-chat-flow-kind=steering]):has(~:is(...)) .xxx_actions{opacity:0}
```

⇒ 它是**官方自用契约**，属于对外表现层的一部分，不是内部实现细节。

### 3.2 气泡内容：只有构建哈希类名 ⚠️

`UserStyleBubble` 的 DOM 形状：

```
userRow                      ← Sixlwa_userRow
└ userStack                  ← Sixlwa_userStack
  ├ attachmentRow            （仅当有附件）
  ├ bubble                   ← Sixlwa_bubble      ★ 要折叠的内容
  ├ contextRow / referenceSummary
  └ actions
```

类名形如 `<hash>_<semantic>`：哈希 `Sixlwa` **随构建变化**，语义后缀 `_bubble` 稳定。

组件上的 `data-*` 属性**全是条件性的**，只在该状态出现：

| 属性 | 出现条件 |
|---|---|
| `data-message-attachments` | 有附件时 |
| `data-pending-steering` | 排队中 |
| `data-submission-echo` | 回显态 |

⇒ **没有无条件的属性可用于锚定气泡内容。** 这就是为什么插件必须用 JS 在
`[data-chat-flow-kind="user"]` 范围内匹配一次 `[class*="_bubble"]`，随后改用自有属性。

### 3.3 气泡的实测样式（决定测量与折叠算法）

```css
.Sixlwa_bubble {
  background: var(--dsw-specific-bubble);
  max-width: 100%;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;          /* ← 保留换行：长文本因此会撑高 */
  word-break: break-word;
  border-radius: 22px;
  padding: 10px 16px;
}
.Sixlwa_userStack { max-width: min(calc(var(--dsh-chat-content-width,748px) * .702), 82%) }
```

三个要点：

1. **`white-space: pre-wrap`** —— 这是「用户消息会变得很长」的直接原因。
2. **`line-height` 引用了 `--dsh-content-font-delta`** —— 用户改字号时行高随之变化，
   所以折叠高度**不能硬编码 px**（插件用 `lh` 单位 + JS 兜底，见样式源码注释）。
3. **没有声明 `box-sizing`** ⇒ 是 `content-box`，**`max-height` 只限制内容区**，
   上下 padding（共 20px）额外加在外层。折叠高度算法必须把这一条算进去。

### 3.4 伪元素未被占用 ✅

检查结果：`Sixlwa_bubble::after`、`::before`、`:hover` **均无官方规则**。

不过本插件仍**不用伪元素**做底部渐隐 —— 改用 `mask-image`。理由：伪元素是单例槽位，
用掉一个就少一个（官方将来若要在此加效果就会冲突）；`mask` 不占槽位、也不插入会
影响布局的盒子。

## 四、结论与取舍

| 问题 | 结论 |
|---|---|
| 用户消息行怎么锚定 | `[data-chat-flow-kind="user"]` —— 官方自用契约，**稳定** |
| 气泡内容怎么锚定 | 只有哈希类名；在上一行的**限定范围内**匹配 `_bubble` 一处，随后换用自有属性 |
| 能否纯 CSS | **不能** —— 需要「测量内容高度」与「点击交互」两件事 |
| 官方是否已有同类折叠 | 有 `data-turn-process-*` 系列的**回合过程**折叠（助手侧）；**不覆盖用户消息** |

### 已知脆弱点

**`[class*="_bubble"]` 这一处依赖 CSS Module 的语义后缀。** 若 DSH 改动命名约定，
插件会**静默停止工作**（不报错、消息不再折叠）。这是当前可用的最稳锚点；
把范围锁在 `[data-chat-flow-kind="user"]` 内已把误伤风险降到最低。

若要彻底消除这个依赖，唯一办法是官方为气泡元素补一个无条件的语义属性 ——
届时本插件可改为纯属性锚定。
