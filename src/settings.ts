/**
 * 插件设置 / Plugin settings
 */

import { PluginSettingTab, Setting, App } from 'obsidian';
import type ShareToSavePlugin from './main';
import type { ShareToSaveSettings, QueueFileLocation } from './types';
import type { Translator } from './i18n';

/** 默认设置 / Default settings */
export const DEFAULT_SETTINGS: ShareToSaveSettings = {
	outputFolder: 'Share-to-Save',
	queueFileLocation: 'vault',
};

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

		// ── 保存文件夹 / Output folder ──
		new Setting(containerEl)
			.setName(this.t('settings.folder.name'))
			.setDesc(this.t('settings.folder.desc'))
			.addText(text =>
				text
					.setPlaceholder('Share-to-Save')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed) {
							this.plugin.settings.outputFolder = trimmed;
							await this.plugin.saveSettings();
						}
					})
			);

		// ── 队列文件存储位置 / Queue file location ──
		new Setting(containerEl)
			.setName(this.t('settings.queueLocation.name'))
			.setDesc(this.t('settings.queueLocation.desc'))
			.addDropdown(dropdown =>
				dropdown
					.addOption('vault', this.t('settings.queueLocation.vault'))
					.addOption('plugin', this.t('settings.queueLocation.plugin'))
					.setValue(this.plugin.settings.queueFileLocation)
					.onChange(async (value) => {
						this.plugin.settings.queueFileLocation = value as QueueFileLocation;
						await this.plugin.saveSettings();
					})
			);

		// ── 队列同步说明 / Queue sync instructions ──
		const syncHintEl = containerEl.createDiv({ cls: 'setting-item-description' });
		syncHintEl.createEl('p').setText(this.t('settings.queueLocation.syncHint'));

		const syncPluginEl = containerEl.createDiv({ cls: 'setting-item-description' });
		const linkText = 'Fast Note Sync';
		const linkHref = 'https://github.com/haierkeys/obsidian-fast-note-sync/';
		const hintText = this.t('settings.queueLocation.syncPluginHint', { link: linkText });
		// 在链接位置将文本拆分为前后两段，中间插入可点击链接
		// Split text around link placeholder and insert clickable link
		const linkIdx = hintText.indexOf(linkText);
		if (linkIdx >= 0) {
			syncPluginEl.createSpan({ text: hintText.slice(0, linkIdx) });
			syncPluginEl.createEl('a', { href: linkHref, text: linkText });
			syncPluginEl.createSpan({ text: hintText.slice(linkIdx + linkText.length) });
		} else {
			syncPluginEl.createEl('p').setText(hintText);
		}
	}
}
