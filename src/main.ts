/**
 * Share to Save 插件主入口
 * Share to Save plugin main entry
 *
 * 手机端：接收分享 URL，写入 toBeSaved_*.json 队列文件
 * 电脑端：轮询队列目录，下载内容并保存为 .md
 *
 * Mobile: receive shared URLs, write toBeSaved_*.json queue files
 * Desktop: poll queue directory, download content and save as .md
 */

import { Plugin, Platform, getLanguage } from 'obsidian';
import type { ShareToSaveSettings } from './types';
import { DEFAULT_SETTINGS, ShareToSaveSettingTab } from './settings';
import { detectLocale, createTranslator } from './i18n';
import type { Translator } from './i18n';
import { extractUrl, extractUrls } from './url-extractor';
import { QueueManager } from './queue-manager';
import { Downloader } from './downloader';
import { FileWatcher } from './file-watcher';
import { ShareMenuInjector } from './share-menu-injector';
import { ImageShareMenuInjector } from './image-share-injector';
import { InputModal } from './input-modal';
import { TextSaver } from './text-saver';
import { showNotice } from './notice-utils';

export default class ShareToSavePlugin extends Plugin {
	settings!: ShareToSaveSettings;
	private t!: Translator;
	private queueManager!: QueueManager;
	private downloader!: Downloader;
	private fileWatcher!: FileWatcher;
	private shareMenuInjector!: ShareMenuInjector;
	private imageShareInjector!: ImageShareMenuInjector;
	private ribbonIconEl!: HTMLElement;
	private textSaver!: TextSaver;
	private isInputModalOpen = false;

	async onload(): Promise<void> {
		// ── 加载设置 / Load settings ──
		await this.loadSettings();

		// ── 初始化 i18n / Initialize i18n ──
		const locale = detectLocale(getLanguage());
		this.t = createTranslator(locale);

		// ── 初始化队列管理器 / Initialize queue manager ──
		this.queueManager = new QueueManager(
			this.app.vault,
			this.settings.outputFolder,
			this.app.metadataCache,
		);

		// ── 初始化文字保存器 / Initialize text saver ──
		this.textSaver = new TextSaver(this.app.vault, this.settings);

		// ── 初始化分享菜单注入器（移动端）/ Initialize share menu injector (mobile) ──
		this.shareMenuInjector = new ShareMenuInjector(
			(text) => this.handleTextSave(text, this.settings.timestampEnabled),
			(url) => this.handleSharedUrl(url),
			this.t,
		);

		if (Platform.isMobile) {
			this.shareMenuInjector.start();
		}

		// ── 初始化图片分享菜单注入器（移动端）/ Initialize image share menu injector (mobile) ──
		this.imageShareInjector = new ImageShareMenuInjector(
			this.app,
			() => this.settings.outputFolder,
			this.t,
		);
		if (Platform.isMobile) {
			this.imageShareInjector.start();
		}

		// ── 初始化下载器和文件监听器（桌面端）/ Initialize downloader & watcher (desktop) ──
		if (Platform.isDesktop) {
			this.downloader = new Downloader(
				this.app.vault,
				this.settings,
				this.t,
			);

			this.fileWatcher = new FileWatcher(
				this.queueManager,
				this.downloader,
				(msg) => {
					console.debug(`Share to Save: ${msg}`);
				},
				() => this.getPollIntervalMs(),
				this.t,
			);
			this.fileWatcher.start();
			this.fileWatcher.onProcessingChange = (processing) => {
				this.ribbonIconEl.classList.toggle('sts-processing', processing);
			};
		}

		// ── Ribbon 按钮（全平台）/ Ribbon button (all platforms) ──
		this.ribbonIconEl = this.addRibbonIcon('cloud-download', this.t('ribbon.tooltip'), async () => {
			await this.openInputModal();
		});

		// ── 命令（全平台）/ Command (all platforms) ──
		this.addCommand({
			id: 'save-url',
			name: this.t('ribbon.tooltip'),
			callback: async () => {
				await this.openInputModal();
			},
		});

		// ── 自定义 URI 协议处理 / Custom URI protocol handler ──
		// 支持 obsidian://share-to-save 快速唤起 URL 输入框（Android 桌面快捷方式等）
		// Supports obsidian://share-to-save to quickly open the URL input modal (Android shortcuts, etc.)
		this.registerObsidianProtocolHandler('share-to-save', async () => {
			await this.openInputModal();
		});

		// ── 设置页 / Settings tab ──
		this.addSettingTab(new ShareToSaveSettingTab(this.app, this, this.t));
	}

	onunload(): void {
		this.shareMenuInjector?.stop();
		this.imageShareInjector?.stop();
		this.fileWatcher?.stop();
		// 清理残留的移动端 toast / Clean up lingering mobile toast
		activeDocument.querySelector('.sts-mobile-toast')?.remove();
	}

	// ─── 核心方法 / Core methods ────────────────────────────────────────────

	/**
	 * 统一的 URL 处理入口（来自分享菜单或直接输入）
	 * Unified URL handling entry point (from share menu or direct input)
	 *
	 * 处理流程 / Flow:
	 *   提取 URL → 写入队列 → 桌面端立即触发处理 / extract URL → write queue → trigger desktop processing
	 */
	private async handleSharedUrl(text: string): Promise<void> {
		const url = extractUrl(text);
		if (!url) {
			showNotice(this.t('notice.noUrl'));
			return;
		}

		await this.queueManager.appendEntry(
			QueueManager.buildEntry(url, Platform.isDesktop ? 'desktop' : 'mobile'),
		);

		// 桌面端立即触发处理 / Desktop: trigger immediate processing
		if (Platform.isDesktop) {
			await this.fileWatcher?.processNow();
		}

		showNotice(this.t('notice.saved'));
	}

	/**
	 * 保存文字到 Share-to-Save.md（非 URL，不进入下载队列）
	 * Save text to Share-to-Save.md (non-URL, bypasses download queue)
	 */
	private async handleTextSave(text: string, addTimestamp: boolean): Promise<void> {
		try {
			await this.textSaver.save(text, addTimestamp);
			showNotice(this.t('notice.textSaved'));
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error('Share to Save: 保存文字失败 / Text save failed:', errMsg);
			showNotice(this.t('notice.downloadFailed', { error: errMsg }), 5000);
		}
	}

	/**
	 * 处理 InputModal 的提交（支持多 URL，逐一入队后立即处理）
	 * Handle submission from InputModal (supports multiple URLs, enqueue then process)
	 *
	 * @param text 用户输入的文本 / User input text
	 */
	private async handleUrlInput(text: string): Promise<void> {
		try {
			const urls = extractUrls(text);
			if (urls.length === 0) {
				showNotice(this.t('notice.noUrl'));
				return;
			}

			// 统一入队 / Enqueue all URLs
			for (const url of urls) {
				await this.queueManager.appendEntry(
					QueueManager.buildEntry(url, Platform.isDesktop ? 'desktop' : 'mobile'),
				);
			}

			// 数量通知 / Count notification
			if (urls.length === 1) {
				showNotice(this.t('notice.saved'));
			} else {
				showNotice(this.t('notice.savedMultiple', { count: String(urls.length) }));
			}

			// 立即处理（桌面端）/ Process immediately (desktop)
			if (Platform.isDesktop) {
				await this.fileWatcher?.processNow();
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error('Share to Save: URL 处理失败 / URL processing failed:', errMsg);
			showNotice(this.t('notice.downloadFailed', { error: errMsg }), 5000);
		}
	}

	/**
	 * 打开 输入模态框 / Open input modal
	 *
	 * 桌面端存在 pending 条目时预填 URL，点击"保存网页"直接触发处理
	 * On desktop, pre-fill pending URLs and trigger processing directly on submit
	 */
	private async openInputModal(): Promise<void> {
		// 防重入守卫：如果已有输入框打开则跳过 / Re-entry guard: skip if modal already open
		// 先置 true 避免 await 期间的竞态 / Set true first to prevent race during await
		if (this.isInputModalOpen) return;
		this.isInputModalOpen = true;

		// 桌面端：检查是否有待处理的队列条目 / Desktop: check for pending queue entries
		if (Platform.isDesktop) {
			const pendingEntries = await this.queueManager.getPendingEntries();
			if (pendingEntries.length > 0) {
				const urls = pendingEntries.map(e => e.url).join('\n');
				new InputModal(
					this.app,
					this.t,
					(text, addTimestamp) => this.handleTextSave(text, addTimestamp),
					async () => {
						await this.fileWatcher?.processNow();
					},
					urls,
					() => { this.isInputModalOpen = false; },
					this.settings.timestampEnabled,
					async (enabled) => {
						this.settings.timestampEnabled = enabled;
						await this.saveSettings();
					},
				).open();
				return;
			}
		}

		// 无 pending 条目时使用原有流程（提取 URL → 入队 → 处理）
		// Use existing flow when no pending entries (extract URL → enqueue → process)
		new InputModal(
			this.app, this.t,
			(text, addTimestamp) => this.handleTextSave(text, addTimestamp),
			(text) => this.handleUrlInput(text),
			'',
			() => { this.isInputModalOpen = false; },
			this.settings.timestampEnabled,
			async (enabled) => {
				this.settings.timestampEnabled = enabled;
				await this.saveSettings();
			},
		).open();
	}

	// ─── 设置管理 / Settings management ────────────────────────────────────

	/** 计算轮询间隔（毫秒）/ Calculate poll interval in milliseconds */
	private getPollIntervalMs(): number {
		const { pollIntervalValue, pollIntervalUnit } = this.settings;
		switch (pollIntervalUnit) {
			case 'seconds': return pollIntervalValue * 1000;
			case 'minutes': return pollIntervalValue * 60_000;
			case 'hours': return pollIntervalValue * 3_600_000;
			default: return 30_000;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ShareToSaveSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
