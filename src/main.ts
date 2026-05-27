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
import { extractUrl } from './url-extractor';
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
		this.addRibbonIcon('cloud-download', this.t('ribbon.tooltip'), () => {
			const modal = new UrlInputModal(
				this.app,
				this.t,
				(text, mode) => this.handleUrlInput(text, mode),
			);
			modal.open();
		});

		// ── 命令（全平台）/ Command (all platforms) ──
		this.addCommand({
			id: 'save-url',
			name: this.t('ribbon.tooltip'),
			callback: () => {
				const modal = new UrlInputModal(
					this.app,
					this.t,
					(text, mode) => this.handleUrlInput(text, mode),
				);
				modal.open();
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
	 * 处理 UrlInputModal 的提交
	 * Handle submission from UrlInputModal
	 *
	 * @param text 用户输入的文本 / User input text
	 * @param mode 'queue' — 仅保存到队列; 'processNow' — 保存后立即处理（仅桌面端）
	 */
	private async handleUrlInput(
		text: string,
		mode: 'queue' | 'processNow',
	): Promise<void> {
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

		if (mode === 'processNow' && Platform.isDesktop) {
			new Notice(this.t('notice.saved'));
			await this.fileWatcher?.processNow();
		} else {
			new Notice(this.t('notice.saved'));
		}
	}

	// ─── 设置管理 / Settings management ────────────────────────────────────

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
