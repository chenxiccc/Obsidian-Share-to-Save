/**
 * 无头 Electron BrowserWindow 提取器：处理 JS 动态渲染的页面
 * Headless Electron BrowserWindow extractor: handle JS-rendered pages
 *
 * 仅桌面端可用（依赖 Electron remote.BrowserWindow）
 * Desktop only (depends on Electron remote.BrowserWindow)
 *
 * 参考 ima-copilot-sync 的 HeadlessExtractor 实现
 * Based on ima-copilot-sync's HeadlessExtractor implementation
 */

const LOAD_TIMEOUT_MS = 20_000;
const CONTENT_POLL_INTERVAL_MS = 500;
const CONTENT_POLL_MAX_MS = 10_000;
const BROWSER_PARTITION = 'persist:share-to-save';

/** Chrome UA — 必须硬编码（Obsidian 审核规范禁止使用 navigator API） */
/** Chrome UA — must be hardcoded (navigator API forbidden by Obsidian review guidelines) */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.108 Safari/537.36';

/**
 * 通用内容容器的 CSS 选择器列表（按优先级排序）
 * Generic content container CSS selector list (ordered by priority)
 *
 * 覆盖常见网站的正文区域 / Cover common website content areas
 */
const CONTENT_SELECTORS = [
	// 微信 / WeChat
	'#js_content',
	'.rich_media_content',
	'.share_content_page',
	// 通用文章 / Generic article
	'article',
	'[role="main"]',
	'main',
	// 常见 class / Common classes
	'.post-content',
	'.article-content',
	'.entry-content',
	'.content-body',
	'.post-body',
	'.markdown-body',
	// 兜底 / Fallback
	'.content',
	'#content',
	'#app',
];

export class HeadlessExtractor {
	/**
	 * 尝试通过 headless BrowserWindow 获取 JS 渲染后的 HTML
	 * Try to get JS-rendered HTML via headless BrowserWindow
	 *
	 * @returns 完整的 document.documentElement.outerHTML，失败返回 null
	 */
	async extractRenderedHtml(url: string): Promise<string | null> {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		let RemoteBrowserWindow: any;
		try {
			const { remote } = require('electron');
			RemoteBrowserWindow = remote.BrowserWindow;
		} catch {
			// eslint-disable-next-line no-console
			console.debug('Share to Save: Electron remote 不可用，跳过 headless 提取 / Electron remote unavailable, skipping headless extraction');
			return null;
		}
		if (!RemoteBrowserWindow) {
			return null;
		}

		let win: any = null;
		try {
			win = new RemoteBrowserWindow({
				width: 1,
				height: 1,
				show: false,
				webPreferences: {
					partition: BROWSER_PARTITION,
					nodeIntegration: false,
					contextIsolation: true,
				},
			});

			win.webContents.setUserAgent(CHROME_UA);

			await this.loadUrlWithTimeout(win, url);

			const html = await this.pollContentAndExtract(win);
			return html;
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('Share to Save: Headless 提取失败 / Headless extraction failed:', err);
			return null;
		} finally {
			this.destroyWindow(win);
		}
	}

	/**
	 * 加载 URL 并等待页面加载完成（或超时）
	 * Load URL and wait for page to finish loading (or timeout)
	 */
	private loadUrlWithTimeout(win: any, url: string): Promise<void> {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				// 超时不 reject，仍尝试提取当前 DOM / Don't reject on timeout, still try to extract current DOM
				resolve();
			}, LOAD_TIMEOUT_MS);

			let finished = false;

			win.webContents.once('did-finish-load', () => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				resolve();
			});

			win.webContents.once('did-fail-load', () => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				resolve();
			});

			void win.loadURL(url, {
				userAgent: CHROME_UA,
				extraHeaders: [
					'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
				].join('\n'),
			});
		});
	}

	/**
	 * 轮询内容容器出现后提取 outerHTML
	 * Poll for content container to appear, then extract outerHTML
	 *
	 * 在页面中轮询检查：是否有内容容器包含足够文本（>30 字）或多张图片
	 * Poll the page to check: does any content container have enough text (>30 chars) or multiple images
	 */
	private async pollContentAndExtract(win: any): Promise<string | null> {
		const start = Date.now();

		while (Date.now() - start < CONTENT_POLL_MAX_MS) {
			try {
				const hasContent: boolean = await win.webContents.executeJavaScript(
					`(function() {
						var selectors = ${JSON.stringify(CONTENT_SELECTORS)};
						for (var i = 0; i < selectors.length; i++) {
							try {
								var el = document.querySelector(selectors[i]);
								if (!el) continue;
								var textLen = (el.textContent || '').trim().length;
								var imgCount = el.querySelectorAll('img').length;
								if (textLen > 30 || imgCount >= 2) return true;
							} catch (e) { /* skip */ }
						}
						// 兜底：body 有足够内容 / Fallback: body has enough content
						var bodyText = (document.body.textContent || '').trim().length;
						return bodyText > 200;
					})()`,
				);
				if (hasContent) break;
			} catch {
				// executeJavaScript 在页面未就绪时可能抛异常
				// executeJavaScript may throw if page isn't ready yet
			}
			await new Promise(r => setTimeout(r, CONTENT_POLL_INTERVAL_MS));
		}

		try {
			const html: string = await win.webContents.executeJavaScript(
				'document.documentElement.outerHTML',
			);
			return html;
		} catch {
			return null;
		}
	}

	/**
	 * 销毁 BrowserWindow / Destroy BrowserWindow
	 */
	private destroyWindow(win: any): void {
		if (!win || win.isDestroyed()) return;
		try {
			win.close();
		} catch {
			// 忽略关闭时的错误 / Ignore errors on close
		}
	}
}
