/**
 * 无头 Electron BrowserWindow 提取器：处理 JS 动态渲染的页面
 * Headless Electron BrowserWindow extractor: handle JS-rendered pages
 *
 * 仅桌面端可用（依赖 Electron remote.BrowserWindow）
 * Desktop only (depends on Electron remote.BrowserWindow)
 */

import { CHROME_UA } from './types';

const LOAD_TIMEOUT_MS = 30_000;
const BROWSER_PARTITION = 'persist:share-to-save';
const FIRST_WAIT_MS = 5_000;
const SECOND_WAIT_MS = 5_000;

interface ElectronBrowserWindow {
	webContents: {
		setUserAgent(ua: string): void;
		once(event: string, callback: () => void): void;
		executeJavaScript(code: string): Promise<unknown>;
	};
	loadURL(url: string, options?: Record<string, unknown>): Promise<void>;
	isDestroyed(): boolean;
	close(): void;
}

interface ElectronBrowserWindowConstructor {
	new (options: {
		width: number;
		height: number;
		show: boolean;
		webPreferences: {
			partition: string;
			nodeIntegration: boolean;
			contextIsolation: boolean;
		};
	}): ElectronBrowserWindow;
}

export class HeadlessExtractor {
	async extractRenderedHtml(url: string): Promise<string | null> {
		let RemoteBrowserWindow: ElectronBrowserWindowConstructor | undefined;
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const electron = require('electron') as { remote: { BrowserWindow: ElectronBrowserWindowConstructor } };
			RemoteBrowserWindow = electron.remote.BrowserWindow;
		} catch {
			return null;
		}
		if (!RemoteBrowserWindow) return null;

		let win: ElectronBrowserWindow | null = null;
		try {
			win = new RemoteBrowserWindow({
				width: 1, height: 1, show: false,
				webPreferences: {
					partition: BROWSER_PARTITION,
					nodeIntegration: false,
					contextIsolation: true,
				},
			});
			win.webContents.setUserAgent(CHROME_UA);
			await this.loadUrlWithTimeout(win, url);
			const html = await this.waitForContentAndExtract(win);
			if (html && HeadlessExtractor.hasCaptcha(html)) {
				console.warn('Share to Save: 检测到微信验证码页面 / Detected WeChat captcha page');
				return null;
			}
			return html;
		} catch (err) {
			console.warn('Share to Save: Headless 提取失败 / Headless extraction failed:', err);
			return null;
		} finally {
			this.destroyWindow(win);
		}
	}

	static hasCaptcha(html: string): boolean {
		const indicators = ['js_verify', 'verify_container', '环境异常', '请完成安全验证', '操作频繁'];
		return indicators.some(ind => html.includes(ind));
	}

	/**
	 * 加载 URL 并等待 did-finish-load 或超时。
	 * Load URL and wait for did-finish-load or timeout.
	 */
	private loadUrlWithTimeout(win: ElectronBrowserWindow, url: string): Promise<void> {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => resolve(), LOAD_TIMEOUT_MS);
			let finished = false;
			const onFinish = () => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				resolve();
			};
			win.webContents.once('did-finish-load', onFinish);
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
	 * 两阶段等待 + 内容增长检测：
	 * 测量基线 body 文本 → 等 5s → 提取 HTML + 测量 body → 若增长不足 → 再等 5s → 再次提取。
	 *
	 * Two-stage wait + content growth detection:
	 * Measure baseline body text → wait 5s → extract HTML + measure body → if not grown enough → wait 5s more → extract again.
	 *
	 * 这比固定阈值更可靠：SPA 空壳的导航栏文本不会随着 JS 渲染而增长，
	 * 而真正的文章内容会让 body 文本大幅增长。
	 * More reliable than fixed threshold: SPA shell nav text won't grow with JS rendering,
	 * while real article content causes significant body text growth.
	 */
	private async waitForContentAndExtract(win: ElectronBrowserWindow): Promise<string | null> {
		// 基线 / Baseline
		const baselineLen = await this.getBodyTextLength(win);

		// 第一阶段 / Stage 1
		await new Promise(r => setTimeout(r, FIRST_WAIT_MS));
		const firstHtml = await this.extractHtml(win);
		if (!firstHtml) return null;

		const currentLen = await this.getBodyTextLength(win);
		// 内容显著增长？/ Content grew significantly?
		if (currentLen > baselineLen * 2 && currentLen > 500) return firstHtml;

		// 第二阶段 / Stage 2
		await new Promise(r => setTimeout(r, SECOND_WAIT_MS));
		const secondHtml = await this.extractHtml(win);
		return secondHtml || firstHtml;
	}

	/**
	 * 滚动触发懒加载 + 提取 outerHTML / Scroll to trigger lazy load + extract outerHTML
	 */
	private async extractHtml(win: ElectronBrowserWindow): Promise<string | null> {
		try {
			await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)');
			await new Promise(r => setTimeout(r, 500));
			await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
			await new Promise(r => setTimeout(r, 500));
		} catch { /* 滚动失败不阻塞 / scroll failure doesn't block */ }

		try {
			return await win.webContents.executeJavaScript(
				'document.documentElement.outerHTML',
			) as string;
		} catch {
			return null;
		}
	}

	/**
	 * 获取 body.innerText 长度 / Get body.innerText length
	 */
	private async getBodyTextLength(win: ElectronBrowserWindow): Promise<number> {
		try {
			const len: number = await win.webContents.executeJavaScript(
				'document.body ? (document.body.innerText || "").trim().length : 0',
			) as number;
			return len;
		} catch {
			return 0;
		}
	}

	private destroyWindow(win: ElectronBrowserWindow | null): void {
		if (!win || win.isDestroyed()) return;
		try { win.close(); } catch { /* ignore */ }
	}
}
