/**
 * 插件设置 / Plugin settings
 */

import { PluginSettingTab, Setting, App } from 'obsidian';
import type ShareToSavePlugin from './main';
import type { ShareToSaveSettings } from './types';
import type { Translator } from './i18n';

/** 默认设置 / Default settings */
export const DEFAULT_SETTINGS: ShareToSaveSettings = {
	outputFolder: 'Sts',
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
					.setPlaceholder('Sts')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed) {
							this.plugin.settings.outputFolder = trimmed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
