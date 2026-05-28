# Share to Save

Obsidian 插件 — 将分享的网页 URL 自动下载为 Markdown 笔记。

**手机端分享** → **桌面端自动下载** → **保存到你的知识库**

## 工作流程

1. 手机端分享 URL 到 Obsidian（系统分享菜单或直接粘贴）
2. URL 写入 `tobesave.json` 队列文件
3. 同步到桌面端（iCloud / Syncthing 等）
4. 桌面端插件检测到条目，使用 headless Chromium 渲染页面
5. 提取正文内容 + 图片，保存为 `.md` 笔记

## 功能

- **移动端分享接收** — 通过 DOM 注入在 Obsidian 移动端添加分享菜单按钮
- **桌面端处理** — 自动轮询队列文件（1 小时间隔），或即时手动触发
- **Headless Chromium 渲染** — 处理 JS 渲染页面（微信文章等）
- **微信文章优化** — 专用 Turndown 规则处理微信图文、SVG 图片、推荐阅读链接
- **图片本地化** — 下载外链图片到本地 attachments 文件夹，替换为 wikilink
- **内容哈希去重** — 跨 CDN 重复图片自动合并
- **中英双语界面** — 根据 Obsidian 语言设置自动切换

## 安装

### 手动安装

1. 从 [Releases](https://github.com/chenxiccc/obsidian-share-to-save/releases) 下载最新版本
2. 解压到 `{vault}/.obsidian/plugins/share-to-save/`
3. 在 Obsidian 设置中启用插件

### 从源码构建

```bash
git clone https://github.com/chenxiccc/obsidian-share-to-save.git
cd obsidian-share-to-save
npm install
npm run build
```

## 使用

### 桌面端（直接输入 URL）

- 点击左侧 ribbon 按钮（云下载图标）
- 粘贴包含 URL 的文本或直接粘贴 URL
- 点击"立即保存"

### 移动端（系统分享）

- 在任意 App 中分享网页 → 选择 Obsidian
- 或点击 Obsidian 内的 ribbon 按钮，粘贴文本

### 队列文件位置

```
{vault}/.obsidian/plugins/share-to-save/tobesave.json
```

格式示例：

```json
[{
  "id": "uuid",
  "url": "https://mp.weixin.qq.com/s/...",
  "source": "mobile",
  "status": "pending",
  "createdAt": "2025-01-01T00:00:00",
  "title": "",
  "error": null
}]
```

## 设置

- **输出文件夹** — 笔记保存目录（默认 `Sts`）
- 附件保存到 `{输出文件夹}/attachments/`

## 技术架构

| 模块 | 功能 |
|------|------|
| `content-converter` | 分平台 HTML → Markdown（Turndown + 自定义规则） |
| `downloader` | 下载管线：headless → DOMParser → 转换 → 图片处理 → 保存 |
| `image-handler` | 图片下载、内容哈希去重、wikilink 替换 |
| `headless-extractor` | Electron BrowserWindow 无头渲染 |
| `queue-manager` | tobesave.json 原子读写 |
| `file-watcher` | 1h 间隔轮询 + 双重稳定性检测 |
| `share-menu-injector` | 移动端 MutationObserver + DOM 注入 |
| `url-extractor` | 正则提取 URL（支持中英文字符） |

## 许可

MIT
