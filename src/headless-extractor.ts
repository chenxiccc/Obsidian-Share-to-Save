/**
 * 无头 Electron BrowserWindow 提取器：处理 JS 动态渲染的页面
 * Headless Electron BrowserWindow extractor: handle JS-rendered pages
 *
 * 仅桌面端可用（依赖 Electron remote.BrowserWindow）
 * Desktop only (depends on Electron remote.BrowserWindow)
 */

import { CHROME_UA } from './http-utils';

// ─── 常量 / Constants ──────────────────────────────────────────────────────────

/** 页面加载超时 / Page load timeout */
const LOAD_TIMEOUT_MS = 30_000;
/** 全局超时（从 extractRenderedHtml 开始计时）/ Global timeout (from extractRenderedHtml start) */
const TOTAL_TIMEOUT_MS = 30_000;
/** 信号轮询间隔 / Signal polling interval */
const POLL_INTERVAL_MS = 1_000;
/** 网络静默期：pendingCount === 0 需持续此时间才算空闲 / Network idle: pendingCount must stay 0 for this duration */
const NETWORK_IDLE_MS = 1_000;
/** DOM 稳定阈值：无 MutationObserver 变化的持续时间 / DOM stable: duration without MutationObserver changes */
const DOM_STABLE_MS = 500;
/** 内容稳定所需连续检查次数 / Consecutive stable checks required for content stability */
const CONTENT_STABLE_CHECKS = 2;

const BROWSER_PARTITION = 'persist:share-to-save';

// ─── 接口 / Interfaces ──────────────────────────────────────────────────────

interface ElectronWebContents {
	setUserAgent(ua: string): void;
	once(event: string, callback: (...args: unknown[]) => void): void;
	executeJavaScript(code: string): Promise<unknown>;
	session?: {
		webRequest?: {
			onBeforeRequest(callback: (details: { url: string }, cb?: (opts: Record<string, unknown>) => void) => void): void;
			onCompleted(callback: (details: { url: string }) => void): void;
			onErrorOccurred(callback: (details: { url: string }) => void): void;
		};
	};
}

interface ElectronBrowserWindow {
	webContents: ElectronWebContents;
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

// ─── HeadlessExtractor / 无头提取器 ──────────────────────────────────────────

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

		// 局部状态变量，每次调用独立 / Local state, independent per call
		const networkState = { pendingCount: 0, lastZeroTime: null as number | null, enabled: false };
		const startTime = Date.now();

		let win: ElectronBrowserWindow | null = null;
		try {
			win = new RemoteBrowserWindow({
				width: 1280, height: 720, show: false,
				webPreferences: {
					partition: BROWSER_PARTITION,
					nodeIntegration: false,
					contextIsolation: true,
				},
			});
			win.webContents.setUserAgent(CHROME_UA);

			// 1. 注册网络监听器（必须在 loadURL 之前）/ Register network listeners (must be before loadURL)
			this.registerNetworkListeners(win, networkState);

			// 2. 加载 URL / Load URL
			await this.loadUrlWithTimeout(win, url);

			// 3. 主循环等待（三信号组合判断）/ Main polling loop (three-signal combined check)
			await this.mainPollingLoop(win, networkState, startTime);

			// 4. 触发懒加载 / Trigger lazy loading
			await this.scrollToTriggerLazyLoad(win);

			// 5. 提取 HTML / Extract HTML
			const html = await this.extractHtml(win);

			// 6. 验证码检测 / Captcha detection
			if (html && HeadlessExtractor.hasCaptcha(html)) {
				console.warn('Share to Save: 检测到微信验证码页面 / Detected WeChat captcha page');
				return null;
			}
			return html;
		} catch (err) {
			console.warn('Share to Save: Headless 提取失败 / Headless extraction failed:', err);
			return null;
		} finally {
			// 清理顺序：observer.disconnect → removeListeners → destroyWindow
			// Cleanup order: observer.disconnect → removeListeners → destroyWindow
			try {
				await win?.webContents.executeJavaScript(
					'if (window.__sts_observer) { window.__sts_observer.disconnect(); delete window.__sts_observer; delete window.__sts_lastChange; }'
				);
			} catch { /* ignore */ }
			this.removeNetworkListeners(win, networkState);
			this.destroyWindow(win);
		}
	}

	// ── 验证码检测 / Captcha Detection ──────────────────────────────────────

	static hasCaptcha(html: string): boolean {
		const indicators = ['js_verify', 'verify_container', '环境异常', '请完成安全验证', '操作频繁'];
		return indicators.some(ind => html.includes(ind));
	}

	// ── 网络监听器 / Network Listeners ──────────────────────────────────────

	/**
	 * 注册 webRequest 监听器，跟踪未完成请求计数。
	 * Register webRequest listeners to track pending request count.
	 *
	 * 必须在 loadURL 之前调用，否则丢失初始请求。
	 * Must be called before loadURL, otherwise initial requests are missed.
	 *
	 * networkState 通过对象引用共享，回调直接修改其属性。
	 * networkState is shared by object reference; callbacks mutate its properties directly.
	 *
	 * 如果 Electron API 不支持 webRequest，则 networkState.enabled 保持 false，
	 * checkNetworkIdle 始终返回 true（不阻塞网络等待）。
	 * If Electron API doesn't support webRequest, networkState.enabled stays false,
	 * checkNetworkIdle always returns true (don't block on network).
	 */
	private registerNetworkListeners(
		win: ElectronBrowserWindow,
		state: { pendingCount: number; lastZeroTime: number | null; enabled: boolean },
	): void {
		try {
			const session = win.webContents.session;
			if (!session?.webRequest) return;

			const onBefore = (_details: unknown, cb?: (opts: Record<string, unknown>) => void) => {
				state.pendingCount++;
				if (cb) cb({});
			};
			const onDone = () => { state.pendingCount = Math.max(0, state.pendingCount - 1); };

			session.webRequest.onBeforeRequest(onBefore);
			session.webRequest.onCompleted(onDone);
			session.webRequest.onErrorOccurred(onDone);

			state.enabled = true;

			// 保存回调引用供 removeNetworkListeners 使用
			// Save callback references for removeNetworkListeners
			(state as unknown as Record<string, unknown>)._onBefore = onBefore;
			(state as unknown as Record<string, unknown>)._onDone = onDone;
		} catch {
			// webRequest 不可用时，不阻塞网络等待 / If webRequest unavailable, don't block on network
		}
	}

	/**
	 * 移除 webRequest 监听器。
	 * Remove webRequest listeners.
	 *
	 * Electron webRequest API 的 removeListener 方式因版本而异。当前实现尝试移除，
	 * 若 API 不支持则跳过——窗口销毁后回调操作已销毁的 webContents 不会有实际影响。
	 * Electron webRequest removeListener varies by version. Current implementation tries
	 * to remove; if API doesn't support it, skip.
	 */
	private removeNetworkListeners(
		win: ElectronBrowserWindow | null,
		state: { pendingCount: number; lastZeroTime: number | null; enabled: boolean },
	): void {
		if (!win || !state.enabled) return;
		try {
			const session = win.webContents.session;
			if (!session?.webRequest) return;

			const s = state as unknown as Record<string, unknown>;
			const onBefore = s._onBefore as ((details: { url: string }) => void) | undefined;
			const onDone = s._onDone as ((details: { url: string }) => void) | undefined;

			const wr = session.webRequest as unknown as Record<string, unknown>;
			if (typeof wr.removeBeforeRequestListener === 'function' && onBefore) {
				(wr.removeBeforeRequestListener as (cb: (details: { url: string }) => void) => void)(onBefore);
			}
			if (typeof wr.removeCompletedListener === 'function' && onDone) {
				(wr.removeCompletedListener as (cb: (details: { url: string }) => void) => void)(onDone);
			}
			if (typeof wr.removeErrorOccurredListener === 'function' && onDone) {
				(wr.removeErrorOccurredListener as (cb: (details: { url: string }) => void) => void)(onDone);
			}
			state.enabled = false;
		} catch { /* ignore */ }
	}

	// ── 网络空闲检查 / Network Idle Check ──────────────────────────────────

	/**
	 * 即时检查网络是否空闲。
	 * Check if network is currently idle.
	 *
	 * 规则：pendingCount === 0 持续 NETWORK_IDLE_MS 以上。
	 * Rule: pendingCount === 0 sustained for at least NETWORK_IDLE_MS.
	 *
	 * 若 webRequest 未启用（enabled === false），始终返回 true。
	 * If webRequest is not enabled, always returns true.
	 */
	private checkNetworkIdle(state: { pendingCount: number; lastZeroTime: number | null; enabled: boolean }): boolean {
		if (!state.enabled) return true;

		if (state.pendingCount === 0) {
			if (state.lastZeroTime === null) {
				state.lastZeroTime = Date.now();
			}
			return (Date.now() - state.lastZeroTime) >= NETWORK_IDLE_MS;
		} else {
			state.lastZeroTime = null;
			return false;
		}
	}

	// ── DOM 稳定检查 / DOM Stable Check ────────────────────────────────────

	/**
	 * 注入 MutationObserver 到页面 JS 上下文（主循环开始前调用一次）。
	 * Inject MutationObserver into page JS context (called once before main loop).
	 */
	private async injectDomObserver(win: ElectronBrowserWindow): Promise<void> {
		try {
			await win.webContents.executeJavaScript(
				'if (!window.__sts_observer) {' +
				'  window.__sts_lastChange = Date.now();' +
				'  window.__sts_observer = new MutationObserver(function() { window.__sts_lastChange = Date.now(); });' +
				'  window.__sts_observer.observe(document, { childList: true, subtree: true, characterData: true });' +
				'}'
			);
		} catch { /* ignore */ }
	}

	/**
	 * 即时检查 DOM 是否稳定（500ms 内无变化）。
	 * Check if DOM is currently stable (no changes in 500ms).
	 */
	private async checkDomStable(win: ElectronBrowserWindow): Promise<boolean> {
		try {
			const stable: boolean = await win.webContents.executeJavaScript(
				'typeof window.__sts_lastChange === "number" && (Date.now() - window.__sts_lastChange) > ' + DOM_STABLE_MS
			) as boolean;
			return stable;
		} catch {
			return false;
		}
	}

	// ── 内容稳定检查 / Content Stable Check ──────────────────────────────

	/**
	 * 即时检查页面内容是否稳定。
	 * Check if page content is currently stable.
	 *
	 * 稳定定义：body.innerText.length 与上次检查相同且 > 0。
	 * Stable definition: body.innerText.length unchanged from last check and > 0.
	 *
	 * @param state.lastLen 上次检查长度 / Length from last check
	 * @param state.stableCount 连续稳定次数 / Consecutive stable count
	 * @returns 是否达到 CONTENT_STABLE_CHECKS 次连续稳定 / Whether CONTENT_STABLE_CHECKS consecutive stables reached
	 */
	private async checkContentStable(
		win: ElectronBrowserWindow,
		state: { lastLen: number; stableCount: number },
	): Promise<boolean> {
		try {
			const currentLen: number = await win.webContents.executeJavaScript(
				'((document.body && document.body.innerText) || "").trim().length'
			) as number;
			if (currentLen > 0 && currentLen === state.lastLen) {
				state.stableCount++;
			} else {
				state.stableCount = 0;
			}
			state.lastLen = currentLen;
			return state.stableCount >= CONTENT_STABLE_CHECKS;
		} catch {
			return false;
		}
	}

	// ── 主轮询循环 / Main Polling Loop ─────────────────────────────────────

	/**
	 * 主轮询循环：每 POLL_INTERVAL_MS 检查三种信号，满足条件时返回。
	 * Main polling loop: check three signals every POLL_INTERVAL_MS, return when condition met.
	 *
	 * 内容就绪使用内容稳定检测（body.innerText 停止增长），无固定字符数阈值。
	 * Content ready uses content stability detection (body.innerText stops growing), no fixed char threshold.
	 *
	 * @param startTime extractRenderedHtml 开始时间戳，用于全局超时计算
	 */
	private async mainPollingLoop(
		win: ElectronBrowserWindow,
		networkState: { pendingCount: number; lastZeroTime: number | null; enabled: boolean },
		startTime: number,
	): Promise<void> {
		// 注入 MutationObserver（只执行一次）/ Inject MutationObserver (once)
		await this.injectDomObserver(win);

		// 内容稳定状态 / Content stability state
		const contentState = { lastLen: 0, stableCount: 0 };

		while (true) {
			await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

			const elapsed = Date.now() - startTime;

			const networkIdle = this.checkNetworkIdle(networkState);
			const domStable = await this.checkDomStable(win);
			const contentStable = await this.checkContentStable(win, contentState);

			// 条件 1：全部就绪 → 立即返回
			// Condition 1: all ready → return immediately
			if (networkIdle && domStable && contentStable) {
				return;
			}

			// 条件 2：DOM 稳定 + 内容稳定（网络可能长连接/WebSocket 永不空闲）
			// Condition 2: DOM stable + content stable (network may never idle due to WebSocket)
			if (domStable && contentStable) {
				await new Promise(r => setTimeout(r, 2000));
				return;
			}

			// 条件 3：全局超时 30s（从 startTime 算起，非主循环开始）
			// Condition 3: global timeout 30s (from startTime, not from polling start)
			if (elapsed > TOTAL_TIMEOUT_MS) {
				return;
			}
		}
	}

	// ── 页面加载 / Page Loading ──────────────────────────────────────────────

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

	// ── 滚动触发懒加载 / Scroll to Trigger Lazy Load ────────────────────────

	/**
	 * 分步滚动触发懒加载。
	 * Step scroll to trigger lazy loading.
	 * 先快速滚到底部 → 等 800ms（给图片加载时间）→ 瞬间跳回顶部 → 等 500ms。
	 * Scroll to bottom → wait 800ms → instant jump to top → wait 500ms.
	 */
	private async scrollToTriggerLazyLoad(win: ElectronBrowserWindow): Promise<void> {
		try {
			await win.webContents.executeJavaScript(
				'window.scrollTo(0, document.body.scrollHeight)'
			);
			await new Promise(r => setTimeout(r, 800));
			await win.webContents.executeJavaScript(
				'window.scrollTo(0, 0)'
			);
			await new Promise(r => setTimeout(r, 500));
		} catch {
			/* 滚动失败不阻塞 / scroll failure doesn't block */
		}
	}

	// ── HTML 提取 / HTML Extraction ──────────────────────────────────────────

	/**
	 * 提取 documentElement.outerHTML。
	 * Extract documentElement.outerHTML.
	 */
	private async extractHtml(win: ElectronBrowserWindow): Promise<string | null> {
		try {
			return await win.webContents.executeJavaScript(
				'document.documentElement.outerHTML',
			) as string;
		} catch {
			return null;
		}
	}

	// ── 窗口销毁 / Window Destruction ────────────────────────────────────────

	private destroyWindow(win: ElectronBrowserWindow | null): void {
		if (!win || win.isDestroyed()) return;
		try { win.close(); } catch { /* ignore */ }
	}
}
