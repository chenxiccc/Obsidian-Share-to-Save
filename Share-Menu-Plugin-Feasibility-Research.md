# Obsidian 手机端分享菜单插件可行性研究

## 研究目标

在 Obsidian 手机端，通过其他应用分享 URL 到 Obsidian 时，会弹出一个半浮层菜单。研究是否可以在该菜单的"在日记中插入文本"下方添加一个自定义按钮"保存到 Share to Save"。

## 分享菜单的结构

当用户从外部应用（如微信、浏览器）分享 URL 到 Obsidian 时，Obsidian 会显示一个半浮层菜单：

```html
<!-- 选择器: document.querySelector("body > div.menu") -->
<div class="menu">
  <div class="menu-grabber"></div>
  <div class="menu-scroll">
    <!-- URL 展示区域 -->
    <div class="menu-group">
      <div class="menu-item is-label selected" data-section="title">
        <div class="menu-item-title">https://example.com/...</div>
      </div>
    </div>
    <div class="menu-separator"></div>

    <!-- 操作按钮区域 -->
    <div class="menu-group">
      <div class="menu-item-title u-muted u-small">将文本插入到文件：</div>
      <div class="menu-item tappable" data-section="options">
        插入文本至文件 TODO
      </div>
      <div class="menu-item tappable" data-section="options">
        选择要插入的文件
      </div>
      <div class="menu-item tappable" data-section="options">
        在日记中插入文本
      </div>
    </div>
    <div class="menu-separator"></div>

    <!-- 取消按钮 -->
    <div class="menu-group">
      <div class="menu-item tappable" data-section="danger">
        取消
      </div>
    </div>
  </div>
</div>
```

| 按钮 | 说明 |
|------|------|
| 插入文本至文件 XXX | 将分享内容插入到当前打开的文件 |
| 选择要插入的文件 | 打开文件选择器，选择目标文件 |
| 在日记中插入文本 | 将分享内容插入到每日日记 |
| 取消 | 关闭菜单，不做任何操作 |

## 相关 API 排查结果

### 完整的 Workspace 事件列表（已全部排查）

以下事件来自 `obsidian.d.ts` 第 7550-7652 行，**没有任何事件与手机端分享相关**：

- `quick-preview` — 快速预览
- `resize` — 窗口大小改变
- `active-leaf-change` — 活动叶子改变
- `file-open` — 文件打开
- `layout-change` — 布局改变
- `window-open` / `window-close` — 窗口打开/关闭
- `css-change` — CSS 变化
- `file-menu` — 文件右键菜单
- `files-menu` — 多文件右键菜单
- `url-menu` — 笔记中 URL 链接右键菜单（仅桌面端）
- `editor-menu` — 编辑器右键菜单
- `editor-change` / `editor-paste` / `editor-drop` — 编辑器事件
- `quit` — 退出

### 最接近但不适用的 API

| API | 位置 | 说明 | 是否可用 |
|-----|------|------|----------|
| `Workspace.on('url-menu')` | obsidian.d.ts:7614 | 桌面端右键点击 URL 链接时触发，可获取 `Menu` 和 `url`，支持 `menu.addItem()` | 否，仅桌面端 |
| `Plugin.registerObsidianProtocolHandler(action, handler)` | obsidian.d.ts:4875 | 注册 `obsidian://` 自定义协议处理函数 | 否，不参与分享流程 |
| `View.onPaneMenu()` | obsidian.d.ts:7185 | 向窗格菜单添加自定义项 | 否，与分享菜单无关 |
| `Menu.addItem()` / `MenuItem.setSection()` | obsidian.d.ts:4133/4221 | 向现有 Menu 对象添加菜单项 | 否，无法获取分享菜单的引用 |

### 关键发现

1. **该菜单在 API 中没有正式名称**。社区中称其为 "Add text to file" 菜单。
2. **菜单是硬编码的**。按钮选项完全由 Obsidian 内部代码（Capacitor JS 层）渲染，未暴露给插件系统。
3. **没有插件介入点**。整个分享流程由 Obsidian 内部处理：原生层接收分享数据 → Capacitor 传递 → JS 渲染菜单，不触发任何公共事件。
4. **`registerObsidianProtocolHandler` 不参与此流程**。分享传入的数据不会生成 `obsidian://` URL。

## 分享流程分析

```
外部应用（微信、浏览器等）
        │
        ▼
iOS: Share Extension / Android: ACTION_SEND Intent
        │
        ▼
Obsidian 原生层（Capacitor 封装）
        │
        ▼
JavaScript 层渲染内部 UI 半浮层
        │
        ▼
用户选择按钮 → 硬编码逻辑处理
        │
        └── 没有插件钩子被触发
```

## 可行的替代方案

### 方案 1：自定义 Obsidian URI Scheme + 系统自动化

**可行性：中等 | 用户体验：较差**

通过 `registerObsidianProtocolHandler` 注册自定义协议：

```typescript
// 在插件的 onload() 中
this.registerObsidianProtocolHandler('share-to-save', (params) => {
  const url = params.url;
  const title = params.title;
  // 处理保存逻辑
});
```

然后通过 iOS 快捷指令 (Shortcuts) 或 Android Tasker 创建自动化，使分享内容转为调用 `obsidian://share-to-save?url=...&title=...`。

**优点**：使用官方 API，稳定可靠
**缺点**：用户需要额外配置自动化，无法直接在分享菜单中点击按钮

### 方案 2：DOM 注入（参考 obsidian-fast-note-sync 的实现）

**可行性：中等偏高 | 用户体验：好 | 风险：中等**

#### 2.1 参考案例：obsidian-fast-note-sync 注入右上角菜单按钮

commit `eaad520` 实现了一个功能：将 FNS 连接状态图标注入到 Obsidian 移动端右上角的 `.view-actions` 按钮组中。

**核心实现方式**（`src/lib/menu_manager.ts`）：

```typescript
// 注入按钮到 view-actions 按钮组 / Inject button into view-actions
updateMobileHeaderIcon(status: boolean) {
  this.plugin.app.workspace.iterateRootLeaves((leaf) => {
    // 通过 containerEl 向下查找 .view-actions
    const viewActions = leaf.view.containerEl.querySelector('.view-actions') as HTMLElement | null;
    if (!viewActions) return;

    // 防重复创建
    let btn = viewActions.querySelector('.fns-status-action') as HTMLElement | null;
    if (!btn) {
      btn = viewActions.createEl('button', {
        cls: 'clickable-icon view-action fns-status-action',
        attr: { 'aria-label': 'FNS Menu' }
      });
      viewActions.prepend(btn);  // 插入到按钮组最前面
    }

    // 设置图标和点击事件
    setIcon(btn, status ? 'wifi' : 'wifi-off');
    btn.onclick = (e) => this.showRibbonMenu(e as MouseEvent);
  });
}
```

**关键技巧总结**：

| 技巧 | 说明 |
|------|------|
| DOM 查找 | `containerEl.querySelector('.view-actions')` — 复用 Obsidian 自身的 CSS 类名 |
| 防重复 | 先 `querySelector` 检查，存在则复用，不存在才创建 |
| 元素创建 | 使用 Obsidian 的 `HTMLElement.createEl()` 方法（不是 `document.createElement`） |
| 插入位置 | `prepend()` 插入到最前面 |
| 生命周期 | 在 `active-leaf-change` 事件中重新注入，在 `onunload` 中清理 |
| CSS 类名 | 复用 Obsidian 原生类名（`clickable-icon view-action`）使样式与原生按钮一致 |

#### 2.2 应用到分享菜单的方案

分享菜单的结构非常规整，可以通过类似手法注入按钮。目标是在"在日记中插入文本"按钮下方、"取消"按钮上方注入自定义按钮：

```typescript
// 监听分享菜单的出现 / Watch for share menu appearance
private shareMenuObserver: MutationObserver | null = null;

onload() {
  this.shareMenuObserver = new MutationObserver(() => {
    this.injectShareMenuButton();
  });
  this.shareMenuObserver.observe(document.body, {
    childList: true,
    subtree: false
  });
}

onunload() {
  this.shareMenuObserver?.disconnect();
}

/**
 * 注入自定义按钮到分享菜单 / Inject custom button into share menu
 */
private injectShareMenuButton() {
  // 找到分享菜单根元素 / Find share menu root element
  const menu = document.querySelector('body > div.menu');
  if (!menu) return;

  // 防重复注入 / Prevent duplicate injection
  if (menu.querySelector('.share-to-save-action')) return;

  // 查找 options 按钮组（包含三个操作按钮） / Find the options button group
  const optionsGroup = menu.querySelector('[data-section="options"]')?.parentElement;
  if (!optionsGroup) return;

  // 找到"在日记中插入文本"按钮 / Find the "insert into daily note" button
  const dailyNoteItem = Array.from(optionsGroup.querySelectorAll('.menu-item.tappable'))
    .find(el => el.textContent?.includes('在日记中插入文本'));

  if (!dailyNoteItem) return;

  // 在当前按钮组中，于"在日记中插入文本"之后创建新按钮
  // 需要操作原生的 .menu-group 容器
  const menuGroup = dailyNoteItem.closest('.menu-group');
  if (!menuGroup) return;

  // 创建自定义按钮（复用 Obsidian 原生类名） / Create custom button (reusing Obsidian native class names)
  const customBtn = createEl('div', {
    cls: 'menu-item tappable share-to-save-action',
    attr: { 'data-section': 'options' }
  });

  // 添加图标 / Add icon
  const iconEl = customBtn.createEl('div', { cls: 'menu-item-icon' });
  // 使用 Obsidian 的 setIcon 或直接设置 SVG
  setIcon(iconEl, 'save'); // 或使用其他合适图标

  // 添加标题 / Add title
  const titleEl = customBtn.createEl('div', { cls: 'menu-item-title' });
  titleEl.setText('保存到 Share to Save');

  // 插入到"在日记中插入文本"之后 / Insert after "insert into daily note"
  dailyNoteItem.after(customBtn);

  // 绑定点击事件 / Bind click event
  customBtn.onclick = () => {
    // 获取分享的 URL / Get shared URL
    const urlEl = menu.querySelector('[data-section="title"] .menu-item-title');
    const sharedUrl = urlEl?.textContent || '';

    // 关闭分享菜单 / Close share menu
    // 点击取消按钮来关闭菜单
    const cancelBtn = menu.querySelector('[data-section="danger"]') as HTMLElement;
    cancelBtn?.click();

    // 执行自定义保存逻辑 / Execute custom save logic
    this.handleSharedUrl(sharedUrl);
  };
}
```

#### 2.3 误检测风险：`body > div.menu` 可能误匹配其他菜单

Obsidian 中 `.menu` 类是一个通用类，多种浮层菜单都使用它。`body > div.menu` 作为选择器可能匹配到以下菜单：

| 菜单类型 | DOM 结构 | 触发场景 | 特征标记 |
|----------|----------|----------|----------|
| **分享菜单**（目标） | `body > div.menu` | 外部应用分享 URL 到 Obsidian | ✅ 包含 `[data-section="title"]`（URL文本）、`[data-section="options"]`（操作按钮组）、`[data-section="danger"]`（取消按钮） |
| **右键菜单** | 动态插入，通常也是 `body > div.menu` | 长按/右键 | ❌ 不包含 `data-section` 属性，菜单项结构不同 |
| **命令面板** | `body > div.modal-container > ...` | Ctrl/Cmd+P | ❌ 不在 `body` 的直接子级，有 `.modal-container` 包裹 |
| **文件选择器菜单** | `body > div.menu` | 点击文件列表中的"更多" | ❌ 不包含 `data-section` 属性 |
| **状态栏/底部弹出菜单** | `body > div.mobile-navbar > ...` | 移动端底部导航 | ❌ 不在 `body` 的直接子级 |

**正确检测分享菜单的标志（组合判断）**：

```
body > div.menu
  ├── .menu-group
  │     └── .menu-item[data-section="title"]    ← 必选，包含 URL
  ├── .menu-separator
  ├── .menu-group
  │     ├── .menu-item[data-section="options"]  ← 必选，至少有 1 个
  │     │   （插入文本至文件 / 选择要插入的文件 / 在日记中插入文本）
  ├── .menu-separator
  └── .menu-group
        └── .menu-item[data-section="danger"]   ← 必选，取消按钮
```

要可靠区分分享菜单和其他菜单，需要**组合三个标志性特征**：

```typescript
/**
 * 判断一个 .menu 元素是否是分享菜单
 * Determine whether a .menu element is the share menu
 */
function isShareMenu(menu: HTMLElement): boolean {
  return (
    // 必须是 body 的直接子元素 / Must be direct child of body
    menu.parentElement === document.body &&
    // 必须包含 URL 展示区域 / Must contain URL title section
    menu.querySelector('[data-section="title"]') !== null &&
    // 必须包含操作按钮组 / Must contain options section
    menu.querySelector('[data-section="options"]') !== null &&
    // 必须包含取消按钮 / Must contain danger/cancel section
    menu.querySelector('[data-section="danger"]') !== null
  );
}
```

改进后的 MutationObserver 实现：

```typescript
onload() {
  this.shareMenuObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && node.matches('body > div.menu')) {
          // 二次确认：验证是否是分享菜单 / Double-check: verify it's the share menu
          if (isShareMenu(node)) {
            this.injectShareMenuButton(node);
          }
        }
      }
    }
  });
  this.shareMenuObserver.observe(document.body, {
    childList: true,
    subtree: false  // 只监听 body 的直接子级变化，减少性能开销
  });
}
```

**关于 `class` 和 "activity" 的精确定位**：

- **没有专属 CSS class**：分享菜单根元素只有 `class="menu"`，没有 `share-menu`、`menu-share` 等专属类名
- **没有原生 Activity 暴露**：分享由 Android `ACTION_SEND` Intent / iOS Share Extension 触发，在 Obsidian 原生层（Capacitor）处理后才传给 JS 层渲染菜单。插件运行在 JS 层，无法接触原生 Activity 或事件
- **`layout-change` 事件也不适用**：该事件在 workspace 面板拆分、关闭、重新排列时触发。分享菜单是一个临时浮层（overlay），不会改变 workspace 布局，因此 `layout-change` 不会被触发
- **`body` 元素没有状态 class**：分享菜单弹出时，`<body>` 不会被添加如 `.menu-open`、`.modal-open` 等状态类名

**唯一可靠的精确定位手段就是 `data-section` 组合**。三种 `data-section` 共存是分享菜单独有的 DOM 指纹，与任何其他 Obsidian 菜单都不重叠。

**为什么 `subtree: false` 就够用？**

分享菜单在 Obsidian 中总是作为 `<body>` 的直接子元素插入（`body.appendChild(menu)`），因此 `subtree: false`（只监听 body 直接子级的变化）就能捕获到，无需全局深度监听。这同时也自然地过滤掉了 `.modal-container` 内的菜单（命令面板等）。

#### 2.4 风险评估

对比 obsidian-fast-note-sync 的做法：

| 维度 | FNS 注入 `.view-actions` | 分享菜单注入 `.menu` |
|------|--------------------------|---------------------|
| 目标元素稳定性 | `.view-actions` 是 Obsidian 长期稳定的内部类名 | `.menu` 也是 Obsidian 长期使用的类名，但分享菜单结构可能随版本变化 |
| 触发时机 | `active-leaf-change` 事件（稳定可靠） | 需要 `MutationObserver`（被动监听，可能存在时序问题） |
| 菜单生命周期 | 随 leaf 切换持续存在 | 临时弹出，用户取消后即销毁 |
| 关闭菜单方式 | 不需要关闭 | 需要模拟点击"取消"按钮来关闭菜单 |
| 获取分享数据 | 不需要 | 需要从 DOM 中读取 URL 文本 |
| Obsidian 插件商店审核 | 已有先例通过审核 | 未知，但手法类似 |

**优点**：
- 用户体验好，直接在分享菜单中显示按钮
- 有成功先例（FNS 插件的 DOM 注入已通过 Obsidian 插件商店审核）
- 完全不需要用户额外配置

**缺点**：
- 依赖 Obsidian 内部 DOM 结构，版本升级可能破坏
- 需要 MutationObserver 监听，存在时序风险
- 点击取消按钮来关闭菜单是一种 hack，不够优雅
- 分享数据（URL）通过 DOM 文本读取，不如 API 可靠
- Obsidian 未来可能移除 DOM 操作能力

### 方案 3：向 Obsidian 团队提交功能请求

**可行性：长期 | 用户体验：取决于官方实现**

在 Obsidian 官方论坛或 GitHub 提交功能请求，建议官方在分享菜单中开放插件扩展点。

### 方案 4：使用 `url-menu` 事件（桌面端可用）

**可行性：桌面端可行 | 移动端不可用**

```typescript
this.registerEvent(
  this.app.workspace.on('url-menu', (menu, url) => {
    menu.addItem((item) => {
      item.setTitle('Save to Share to Save')
        .setIcon('save')
        .onClick(() => {
          // 处理 URL
        });
    });
  })
);
```

**优点**：官方 API，稳定可靠
**缺点**：仅桌面端，不适用于手机端分享菜单

## 结论

| 问题 | 答案 |
|------|------|
| 分享菜单在 API 中有名称吗？ | 没有。社区称为 "Add text to file" 菜单。 |
| 是否有 API 在分享菜单中添加按钮？ | **没有。** 菜单选项是硬编码的，无插件扩展点。 |
| `url-menu` 事件能否实现？ | 不能。该事件仅桌面端右键菜单，与手机端分享无关。 |
| `registerObsidianProtocolHandler` 能否实现？ | 间接可用，但不能直接在分享菜单中添加按钮。 |
| DOM 注入可行吗？ | **可行。** 参考 obsidian-fast-note-sync 对 `.view-actions` 的注入先例，通过 MutationObserver + DOM 操作可以向分享菜单注入自定义按钮。 |

**最终结论**：在当前版本的 Obsidian 插件 API 中，不存在任何公共 API 可以在手机端分享菜单中添加自定义按钮。但是，通过 **DOM 注入**的方式可以实现这个功能。具体方法：

1. 使用 `MutationObserver` 监听 `body > div.menu` 的出现
2. 找到包含三个操作按钮的 `.menu-group`
3. 在"在日记中插入文本"按钮之后插入自定义按钮（复用 Obsidian 原生 CSS 类名 `menu-item tappable`）
4. 从 DOM 中读取分享的 URL 数据
5. 通过点击"取消"按钮（`[data-section="danger"]`）关闭菜单
6. 由插件处理保存逻辑

该方案有成功先例——obsidian-fast-note-sync 插件采用相同的 DOM 注入技术将按钮注入到 `.view-actions` 中，并已通过 Obsidian 插件商店审核。主要风险是 Obsidian 未来更新可能改变分享菜单的 DOM 结构。
