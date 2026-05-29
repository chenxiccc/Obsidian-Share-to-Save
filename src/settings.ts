/**
 * 插件设置 / Plugin settings
 */

import { PluginSettingTab, Setting, App } from 'obsidian';
import type ShareToSavePlugin from './main';
import type { ShareToSaveSettings, PollIntervalUnit } from './types';
import type { Translator } from './i18n';

/** 默认设置 / Default settings */
export const DEFAULT_SETTINGS: ShareToSaveSettings = {
	outputFolder: 'Share-to-Save',
	pollIntervalValue: 30,
	pollIntervalUnit: 'seconds',
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

		// ── 使用说明 / Usage Instructions ──
		const headingEl = containerEl.createEl('h2');
		headingEl.setText(this.t('settings.usage.heading'));

		const descEl = containerEl.createDiv({ cls: 'setting-item-description' });
		// 链接文本 / Link text
		const linkText = 'Fast Note Sync';
		const linkHref = 'https://github.com/haierkeys/obsidian-fast-note-sync/';
		const content = this.t('settings.usage.content', { link: linkText });
		const linkIdx = content.indexOf(linkText);
		if (linkIdx >= 0) {
			descEl.createSpan({ text: content.slice(0, linkIdx) });
			descEl.createEl('a', { href: linkHref, text: linkText });
			descEl.createSpan({ text: content.slice(linkIdx + linkText.length) });
		} else {
			descEl.setText(content);
		}

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
}
