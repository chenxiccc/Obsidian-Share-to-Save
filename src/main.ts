/**
 * Share to Save 插件主入口
 * Share to Save plugin main entry
 *
 * 手机端：接收分享 URL，写入 tobesave.json
 * 电脑端：监听 tobesave.json，下载内容并保存为 .md
 *
 * Mobile: receive shared URLs, write to tobesave.json
 * Desktop: watch tobesave.json, download content and save as .md
 */

import { Plugin, Platform, Notice, getLanguage } from 'obsidian';
import type { ShareToSaveSettings } from './types';
import { DEFAULT_SETTINGS, ShareToSaveSettingTab } from './settings';
import { detectLocale, createTranslator } from './i18n';
import type { Translator } from './i18n';
import { extractUrl, extractUrls } from './url-extractor';
import { QueueManager } from './queue-manager';
import { Downloader } from './downloader';
import { FileWatcher } from './file-watcher';
import { ShareMenuInjector } from './share-menu-injector';
import { UrlInputModal } from './url-input-modal';

export default class ShareToSavePlugin extends Plugin {
	settings!: ShareToSaveSettings;
	private t!: Translator;
	private queueManager!: QueueManager;
	private downloader!: Downloader;
	private fileWatcher!: FileWatcher;
	private shareMenuInjector!: ShareMenuInjector;

	async onload(): Promise<void> {
		// ── 加载设置 / Load settings ──
		await this.loadSettings();

		// ── 初始化 i18n / Initialize i18n ──
		const locale = detectLocale(getLanguage());
		this.t = createTranslator(locale);

		// ── 初始化队列管理器 / Initialize queue manager ──
		this.queueManager = new QueueManager(
			this.app.vault,
			this.manifest.id,
		);

		// ── 初始化分享菜单注入器（移动端）/ Initialize share menu injector (mobile) ──
		this.shareMenuInjector = new ShareMenuInjector(
			(url) => this.handleSharedUrl(url),
			this.t,
		);

		if (Platform.isMobile) {
			this.shareMenuInjector.start();
		}

		// ── 初始化下载器和文件监听器（桌面端）/ Initialize downloader & watcher (desktop) ──
		if (Platform.isDesktop) {
			this.downloader = new Downloader(
				this.app.vault,
				this.settings,
			);

			this.fileWatcher = new FileWatcher(
				this.queueManager,
				this.downloader,
				(msg) => {
					// eslint-disable-next-line no-console
					console.debug(`Share to Save: ${msg}`);
				},
			);
			this.fileWatcher.start();
		}

		// ── Ribbon 按钮（全平台）/ Ribbon button (all platforms) ──
		this.addRibbonIcon('cloud-download', this.t('ribbon.tooltip'), async () => {
			await this.openUrlModal();
		});

		// ── 命令（全平台）/ Command (all platforms) ──
		this.addCommand({
			id: 'save-url',
			name: this.t('ribbon.tooltip'),
			callback: async () => {
				await this.openUrlModal();
			},
		});

		// ── 设置页 / Settings tab ──
		this.addSettingTab(new ShareToSaveSettingTab(this.app, this, this.t));
	}

	async onunload(): Promise<void> {
		this.shareMenuInjector?.stop();
		this.fileWatcher?.stop();
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
			new Notice(this.t('notice.noUrl'));
			return;
		}

		await this.queueManager.appendEntry({
			id: crypto.randomUUID(),
			url,
			source: Platform.isDesktop ? 'desktop' : 'mobile',
			status: 'pending',
			createdAt: new Date().toISOString(),
			title: '',
			error: null,
		});

		// 桌面端立即触发处理 / Desktop: trigger immediate processing
		if (Platform.isDesktop) {
			await this.fileWatcher?.processNow();
		}

		new Notice(this.t('notice.saved'));
	}

	/**
	 * 处理 UrlInputModal 的提交（支持多 URL，逐一入队后立即处理）
	 * Handle submission from UrlInputModal (supports multiple URLs, enqueue then process)
	 *
	 * @param text 用户输入的文本 / User input text
	 */
	private async handleUrlInput(text: string): Promise<void> {
		const urls = extractUrls(text);
		if (urls.length === 0) {
			new Notice(this.t('notice.noUrl'));
			return;
		}

		// 统一入队 / Enqueue all URLs
		for (const url of urls) {
			await this.queueManager.appendEntry({
				id: crypto.randomUUID(),
				url,
				source: Platform.isDesktop ? 'desktop' : 'mobile',
				status: 'pending',
				createdAt: new Date().toISOString(),
				title: '',
				error: null,
			});
		}

		// 数量通知 / Count notification
		if (urls.length === 1) {
			new Notice(this.t('notice.saved'));
		} else {
			new Notice(this.t('notice.savedMultiple', { count: String(urls.length) }));
		}

		// 立即处理（桌面端）/ Process immediately (desktop)
		if (Platform.isDesktop) {
			await this.fileWatcher?.processNow();
		}
	}

	/**
	 * 打开 URL 输入模态框 / Open URL input modal
	 *
	 * 桌面端存在 pending 条目时预填 URL，点击"立即保存"直接触发处理
	 * On desktop, pre-fill pending URLs and trigger processing directly on submit
	 */
	private async openUrlModal(): Promise<void> {
		// 桌面端：检查是否有待处理的队列条目 / Desktop: check for pending queue entries
		if (Platform.isDesktop) {
			const pendingEntries = await this.queueManager.getPendingEntries();
			if (pendingEntries.length > 0) {
				const urls = pendingEntries.map(e => e.url).join('\n');
				new UrlInputModal(
					this.app,
					this.t,
					async () => {
						await this.fileWatcher?.processNow();
					},
					urls,
				).open();
				return;
			}
		}

		// 无 pending 条目时使用原有流程（提取 URL → 入队 → 处理）
		// Use existing flow when no pending entries (extract URL → enqueue → process)
		new UrlInputModal(this.app, this.t, (text) => this.handleUrlInput(text)).open();
	}

	// ─── 设置管理 / Settings management ────────────────────────────────────

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
