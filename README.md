[中文说明](#zh)

# Share to Save

![User Flow](assets/UserFlow.png)

An Obsidian plugin that automatically downloads shared web pages as Markdown notes.

**Share / Add links** **from mobile** → **Auto-download on desktop** → **Save to your vault**

## Typical Usage

- **General Web Pages** — Any standard article page (news, blogs, documentation) works out of the box via the built-in defuddle fallback.
- **WeChat Articles** — Share an article from WeChat Official Accounts to Obsidian, and it will be saved with full text, images, and metadata intact.
- **Xiaohongshu (RED) Posts** — Copy a RED post link, add the link in the plugin, and both the text content and all images will be extracted and saved.

## Workflow

### Mobile → Desktop

1. Share a URL to Obsidian on your mobile device (system share menu or paste into the plugin)
2. URL is written to the queue file under the Share-to-Save folder
3. Sync to your desktop (see [Sync Methods](#sync-methods) below)
4. The desktop plugin detects the entry and automatically fetches the full web content, saving it as a `.md` note

#### Desktop (Direct URL Input)

- Click the left ribbon button (cloud download icon)
- Paste text containing a URL, or paste a URL directly
- Click "Save Now"

## Sync Methods

The plugin relies on file sync to transfer the queue file from mobile to desktop. We recommend one of the following:

| Method                                                                         | Cost | Speed            | Setup                                |
| ------------------------------------------------------------------------------ | ---- | ---------------- | ------------------------------------ |
| **[Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/)** | Free | Instant          | Easy — another Obsidian plugin      |
| iCloud                                                                         | Free | ~1-10s           | Built-in on Apple devices            |
| Syncthing                                                                      | Free | ~1-5s            | Cross-platform, self-hosted          |
| Git                                                                            | Free | Manual push/pull | Versioned, but requires manual steps |

**Recommendation:** [Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/) provides near-instant queue delivery — your desktop starts downloading within seconds of sharing on mobile. Unlike iCloud it works cross-platform, and unlike Syncthing it needs no separate daemon.

## Settings

- **Output folder** — Directory for saved notes (default: `Share-to-Save`)
- Attachments are saved to `{outputFolder}/attachments/`

## Submitting Issues

If you encounter extraction problems, please open an issue on [GitHub Issues](https://github.com/chenxiccc/obsidian-share-to-save/issues) with the following information:

1. **The URL** — The specific link you tried to save (required)
2. **What went wrong** — Which part was not extracted correctly? (title, author, body text, images, etc.)
3. **Failure type** — Is it:
   - **Cannot extract at all** (nothing saved, queue stuck, error message shown)
   - **Extraction is wrong** (saved but content is incomplete, garbled, or incorrect)

Providing a sample URL is essential — different pages on the same platform can have completely different HTML structures.

## License

MIT

---

<a id="zh"></a>

# Share to Save（中文）

![用户流程图](assets/UserFlow.png)

Share to Save 是一款 Obsidian 插件，将分享的网页 URL 自动下载为 Markdown 笔记。

**手机端分享 / 添加链接** → **桌面端自动下载** → **保存到你的知识库**

## 典型用法

- **通用网页** — 任何标准文章页面（新闻、博客、文档）均可通过内置 defuddle 兜底直接使用。
- **微信文章** — 分享微信公众号文章到 Obsidian，本地保存包括图片在内的全部内容。
- **小红书笔记** — 复制小红书链接，在插件中添加URL保存，本地保存笔记正文和全部图片。

## 工作流程
#### 手机分享或添加URL → 电脑自动下载
1. 手机端分享通过分享按钮 分享到 Obsidian
2. 在分享菜单里选择 保存到Share to Save
3. 也可以 点击插件ribbon按钮，粘贴添加URL
4. URL 写入 Share-to-Save文件夹下的队列文件
5. 同步到桌面端（见下方[同步方式](#同步方式)）
6. 桌面端插件检测到条目，自动获取网页全部内容，保存为 `.md` 笔记
#### 桌面端（直接输入 URL）
- 点击左侧 ribbon 按钮（云下载图标）
- 粘贴包含 URL 的文本或直接粘贴 URL
- 点击"立即保存"

## 同步方式

插件依赖文件同步将队列文件从手机传输到桌面。推荐以下方式：

| 方式                                                                           | 费用 | 速度             | 配置难度                 |
| ------------------------------------------------------------------------------ | ---- | ---------------- | ------------------------ |
| **[Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/)** | 免费 | 即时             | 简单，免费，强大         |
| iCloud                                                                         | 免费 | ~1-10秒          | Apple 设备内置           |
| Syncthing                                                                      | 免费 | ~1-5秒           | 跨平台，需自托管         |
| Git                                                                            | 免费 | 需手动 push/pull | 有版本控制，但需手动操作 |

**推荐：**[Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/) 可实现近乎即时的队列传送——手机端分享后几秒内桌面端即开始下载。相比 iCloud 支持跨平台，相比 Syncthing 无需额外后台进程。

## 设置

- **输出文件夹** — 笔记保存目录（默认 `Share-to-Save`）
- 附件保存到 `{输出文件夹}/attachments/`

## 提交 Issue

如有提取问题，请在 [GitHub Issues](https://github.com/chenxiccc/obsidian-share-to-save/issues) 提交，并提供以下信息：

1. **提供 URL 链接** — 你尝试保存的具体链接（必填）
2. **哪块提取不对** — 哪部分内容没有正确提取？（标题、作者、正文、图片等）
3. **完全不能提取还是提取错误** — 属于哪种情况：
   - **完全不能提取**（没有保存任何内容、队列卡住、显示错误信息）
   - **提取错误**（保存了但内容不完整、乱码或不正确）

提供示例 URL 至关重要——同一平台的不同页面可能拥有完全不同的 HTML 结构。

## 许可

MIT
