/**
 * 插件设置 / Plugin settings
 */

import { PluginSettingTab, Setting, App, Notice, requestUrl } from 'obsidian';
import type ShareToSavePlugin from './main';
import type { ShareToSaveSettings, PollIntervalUnit } from './types';
import type { Translator } from './i18n';
import { validateFolderPath } from './text-utils';

/** 默认设置 / Default settings */
export const DEFAULT_SETTINGS: ShareToSaveSettings = {
	outputFolder: 'Share-to-Save',
	pollIntervalValue: 30,
	pollIntervalUnit: 'seconds',
};

/** 用户流程图 / User flow diagram constants */
const IMAGE_REMOTE_URL = 'https://raw.githubusercontent.com/chenxiccc/Obsidian-Share-to-Save/main/assets/UserFlow.png';
const IMAGE_LOCAL_PATH = '.obsidian/plugins/share-to-save/assets/UserFlow.png';
const ASSETS_DIR = '.obsidian/plugins/share-to-save/assets/';

export class ShareToSaveSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ShareToSavePlugin,
		private t: Translator,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── 页面标题 / Page title ──
		new Setting(containerEl)
			.setName(this.t('settings.title'))
			.setHeading();

// ── 使用说明 / Usage Instructions ──
		const usageBox = containerEl.createDiv({ cls: 'sts-usage-box' });

		new Setting(usageBox)
			.setName(this.t('settings.usage.heading'))
			.setHeading();

		const descEl = usageBox.createDiv({ cls: 'setting-item-description' });
		// 链接文本 / Link text
		const linkText = 'Fast Note Sync';
		const linkHref = 'https://community.obsidian.md/plugins/fast-note-sync';
		const content = this.t('settings.usage.content', { link: linkText });
		const linkIdx = content.indexOf(linkText);
		if (linkIdx >= 0) {
			descEl.createSpan({ text: content.slice(0, linkIdx) });
			descEl.createEl('a', { href: linkHref, text: linkText });
			descEl.createSpan({ text: content.slice(linkIdx + linkText.length) });
		} else {
			descEl.setText(content);
		}

		// ── 用户流程图 / User flow diagram ──
		const imgContainer = usageBox.createDiv({ cls: 'sts-userflow-container' });
		const img = imgContainer.createEl('img', {
			attr: { alt: 'User Flow' },
		});
		// 异步加载图片：优先本地，失败回退远程 / Load image async: local first, fallback remote
		this.loadImage(img);

// ── 保存文件夹 / Output folder ──
		new Setting(containerEl)
			.setName(this.t('settings.folder.name'))
			.setDesc(this.t('settings.folder.desc'))
			.addText(text =>
				text
					.setPlaceholder('Share-to-Save')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						const errorKey = validateFolderPath(value);
						if (errorKey) {
							new Notice(this.t(errorKey));
							return;
						}
						const trimmed = value.trim();
						this.plugin.settings.outputFolder = trimmed;
						await this.plugin.saveSettings();
					})
			);

// ── 轮询间隔 / Polling interval ──
		new Setting(containerEl)
			.setName(this.t('settings.pollInterval.name'))
			.setDesc(this.t('settings.pollInterval.desc'))
			.addText(text =>
				text
					.setPlaceholder('30')
					.setValue(String(this.plugin.settings.pollIntervalValue))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (num >= 1 && num <= 60) {
							this.plugin.settings.pollIntervalValue = num;
							await this.plugin.saveSettings();
						}
					})
			)
			.addDropdown(dropdown =>
				dropdown
					.addOption('seconds', this.t('settings.pollInterval.seconds'))
					.addOption('minutes', this.t('settings.pollInterval.minutes'))
					.addOption('hours', this.t('settings.pollInterval.hours'))
					.setValue(this.plugin.settings.pollIntervalUnit)
					.onChange(async (value) => {
						this.plugin.settings.pollIntervalUnit = value as PollIntervalUnit;
						await this.plugin.saveSettings();
					})
			);
	}

	/**
	 * 加载图片：优先本地，失败回退远程 URL
	 * Load image: local first, fallback to remote URL
	 */
	private async loadImage(img: HTMLImageElement): Promise<void> {
		const adapter = this.app.vault.adapter;

		// 本地已存在 → 直接用 / Local exists → use directly
		if (await adapter.exists(IMAGE_LOCAL_PATH)) {
			img.src = adapter.getResourcePath(IMAGE_LOCAL_PATH);
			return;
		}

		// 从 GitHub 下载 / Download from GitHub
		try {
			const response = await requestUrl({ url: IMAGE_REMOTE_URL });
			if (response.status === 200 && response.arrayBuffer) {
				// 确保目录存在 / Ensure directory exists
				if (!await adapter.exists(ASSETS_DIR)) {
					await adapter.mkdir(ASSETS_DIR);
				}
				await adapter.writeBinary(IMAGE_LOCAL_PATH, response.arrayBuffer);
				img.src = adapter.getResourcePath(IMAGE_LOCAL_PATH);
				return;
			}
		} catch {
			// 下载失败，降级到远程 URL / Download failed, fallback to remote URL
		}

		img.src = IMAGE_REMOTE_URL;
	}
}
