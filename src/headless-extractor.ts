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

import { CHROME_UA } from './types';

const LOAD_TIMEOUT_MS = 30_000;
const CONTENT_POLL_INTERVAL_MS = 500;
const CONTENT_POLL_MAX_MS = 20_000;
const BROWSER_PARTITION = 'persist:share-to-save';

/**
 * 通用内容容器的 CSS 选择器列表（按优先级排序）
 * Generic content container CSS selector list (ordered by priority)
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
	 * 尝试通过 headless BrowserWindow 获取 JS 渲染后的完整页面 HTML
	 * Try to get JS-rendered full page HTML via headless BrowserWindow
	 *
	 * 返回完整 outerHTML，由调用方通过 DOMParser + contentSelector 提取内容
	 * Returns full outerHTML; caller extracts content via DOMParser + contentSelector
	 *
	 * 参考 ima-copilot-sync tryHeadlessExtraction 实现
	 * Based on ima-copilot-sync's tryHeadlessExtraction
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

			const html = await this.waitForContentAndExtract(win);
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
	 * 判断提取的 HTML 是否包含微信文章内容
	 * Check if extracted HTML contains WeChat article content
	 */
	static hasWeChatContent(html: string): boolean {
		for (const sel of CONTENT_SELECTORS) {
			const key = sel.replace(/^[#.]/, '');
			if (html.includes(key)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * 加载 URL 并等待页面加载完成（或超时）
	 * Load URL and wait for page to finish loading (or timeout)
	 */
	private loadUrlWithTimeout(win: any, url: string): Promise<void> {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => resolve(), LOAD_TIMEOUT_MS);

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
	 * 轮询内容容器出现后提取完整 outerHTML
	 * Poll for content container to appear, then extract full outerHTML
	 *
	 * 参考 ima-copilot-sync HeadlessExtractor.waitForContentAndExtract
	 * Based on ima-copilot-sync's HeadlessExtractor.waitForContentAndExtract
	 */
	private async waitForContentAndExtract(win: any): Promise<string | null> {
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
						return false;
					})()`,
				);
				if (hasContent) break;
			} catch {
				// executeJavaScript 在页面未就绪时可能抛异常
			}
			await new Promise(r => setTimeout(r, CONTENT_POLL_INTERVAL_MS));
		}

		// 触发基础懒加载（快速滚动，不等待——图片 URL 从 data-src 属性直接提取）
		// Trigger basic lazy load (quick scroll, no wait — image URLs extracted from data-src attributes)
		try {
			await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)');
			await new Promise(r => setTimeout(r, 300));
			await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
		} catch {
			// 滚动失败不影响提取 / Scroll failure doesn't block extraction
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
