# Share to Save

![User Flow](images/UserFlow.png)

An Obsidian plugin that automatically downloads shared web pages as Markdown notes.

**Share from mobile/Add links** → **Auto-download on desktop** → **Save to your vault**

Share to Save 是一款 Obsidian 插件，将分享的网页 URL 自动下载为 Markdown 笔记。

**手机端分享/添加链接** → **桌面端自动下载** → **保存到你的知识库**

---

## Typical Usage / 典型用法

- **General Web Pages / 通用网页** — Any standard article page (news, blogs, documentation) works out of the box via the built-in defuddle fallback.
- **WeChat Articles / 微信文章** — Share an article from WeChat Official Accounts to Obsidian, and it will be saved with full text, images, and metadata intact./本地保存微信公众号文章，包括图片。
- **Xiaohongshu (RED) Posts / 小红书笔记** — Share a RED post link, and both the text content and all images will be extracted and saved./本地保存小红书笔记，包括图片。

---

## Workflow / 工作流程

1. Share a URL to Obsidian on your mobile device (system share menu or paste)
2. URL is written to the `tobesave.json` queue file
3. Sync to your desktop (see [Sync Methods](#sync-methods--同步方式) below)
4. The desktop plugin detects the entry and renders the page with headless Chromium
5. Body text + images are extracted and saved as a `.md` note
6. 手机端分享 URL 到 Obsidian（系统分享菜单或直接粘贴）
7. URL 写入 Share-to-Save文件夹下 队列文件
8. 同步到桌面端（见下方[同步方式](#sync-methods--同步方式)）
9. 桌面端插件检测到条目，自动获取网页全部内容，保存为 `.md` 笔记

## Sync Methods / 同步方式

The plugin relies on file sync to transfer the queue file from mobile to desktop. We recommend one of the following:

| Method                                                                         | Cost | Speed            | Setup                                |
| ------------------------------------------------------------------------------ | ---- | ---------------- | ------------------------------------ |
| **[Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/)** | Free | Instant          | Easy — another Obsidian plugin      |
| iCloud                                                                         | Free | ~1-10s           | Built-in on Apple devices            |
| Syncthing                                                                      | Free | ~1-5s            | Cross-platform, self-hosted          |
| Git                                                                            | Free | Manual push/pull | Versioned, but requires manual steps |

**Recommendation:** [Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/) provides near-instant queue delivery — your desktop starts downloading within seconds of sharing on mobile. Unlike iCloud it works cross-platform, and unlike Syncthing it needs no separate daemon.

---

插件依赖文件同步将队列文件从手机传输到桌面。推荐以下方式：

| 方式                                                                           | 费用 | 速度             | 配置难度                 |
| ------------------------------------------------------------------------------ | ---- | ---------------- | ------------------------ |
| **[Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/)** | 免费 | 即时             | 简单，免费，强大         |
| iCloud                                                                         | 免费 | ~1-10秒          | Apple 设备内置           |
| Syncthing                                                                      | 免费 | ~1-5秒           | 跨平台，需自托管         |
| Git                                                                            | 免费 | 需手动 push/pull | 有版本控制，但需手动操作 |

**推荐：**[Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync/) 可实现近乎即时的队列传送——手机端分享后几秒内桌面端即开始下载。相比 iCloud 支持跨平台，相比 Syncthing 无需额外后台进程。

## Usage / 使用

### Desktop (Direct URL Input) / 桌面端（直接输入 URL）

- Click the left ribbon button (cloud download icon)
- Paste text containing a URL, or paste a URL directly
- Click "Save Now" / 点击"立即保存"

### Mobile (Share to obsidian or add links in the plugin) / 移动端（分享到Obsidian或在插件内添加链接）

- Share a web page from any app → select Obsidian
- Or tap the ribbon button inside Obsidian and paste the text

## Settings / 设置

- **Output folder / 输出文件夹** — Directory for saved notes (default: `Sts`)
- Attachments are saved to `{outputFolder}/attachments/`

## Submitting Issues / 提交 Issue

If you encounter extraction problems, please open an issue on [GitHub Issues](https://github.com/chenxiccc/obsidian-share-to-save/issues) with the following information:

1. **The URL** — The specific link you tried to save (required)
2. **What went wrong** — Which part was not extracted correctly? (title, author, body text, images, etc.)
3. **Failure type** — Is it:
   - **Cannot extract at all** (nothing saved, queue stuck, error message shown)
   - **Extraction is wrong** (saved but content is incomplete, garbled, or incorrect)

Providing a sample URL is essential — different pages on the same platform can have completely different HTML structures.

---

如有提取问题，请在 [GitHub Issues](https://github.com/chenxiccc/obsidian-share-to-save/issues) 提交，并提供以下信息：

1. **提供 URL 链接** — 你尝试保存的具体链接（必填）
2. **哪块提取不对** — 哪部分内容没有正确提取？（标题、作者、正文、图片等）
3. **完全不能提取还是提取错误** — 属于哪种情况：
   - **完全不能提取**（没有保存任何内容、队列卡住、显示错误信息）
   - **提取错误**（保存了但内容不完整、乱码或不正确）

提供示例 URL 至关重要——同一平台的不同页面可能拥有完全不同的 HTML 结构。

## License / 许可

MIT
