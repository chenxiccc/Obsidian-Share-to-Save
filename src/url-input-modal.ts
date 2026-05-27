/**
 * URL 输入模态框：用户粘贴分享文本，提取 URL 并加入队列
 * URL input modal: user pastes share text, extracts URL and adds to queue
 */

import { Modal, App, Setting, Platform } from 'obsidian';
import type { Translator } from './i18n';
import { extractUrl } from './url-extractor';

export class UrlInputModal extends Modal {
	private textarea!: HTMLTextAreaElement;

	constructor(
		app: App,
		private t: Translator,
		private onSave: (
			text: string,
			mode: 'queue' | 'processNow',
		) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sts-url-input-modal');

		// 标题 / Title
		contentEl.createEl('h3', { text: this.t('modal.title') });

		// 文本输入区 / Text input area
		const textareaEl = contentEl.createEl('textarea', {
			attr: {
				placeholder: this.t('modal.placeholder'),
				rows: '6',
			},
			cls: 'sts-url-textarea',
		});
		this.textarea = textareaEl;

		// 自动聚焦 / Auto focus
		setTimeout(() => textareaEl.focus(), 50);

		// 按钮行 / Button row
		const buttonRow = contentEl.createDiv({ cls: 'sts-button-row' });

		// Desktop: "立即处理" 按钮 / Desktop: "Process now" button
		if (Platform.isDesktop) {
			new Setting(buttonRow)
				.addButton(btn =>
					btn
						.setButtonText(this.t('modal.processNow'))
						.setCta()
						.onClick(() => this.handleSubmit('processNow'))
				);
		}

		// "保存到队列" 按钮 / "Save to queue" button
		new Setting(buttonRow)
			.addButton(btn =>
				btn
					.setButtonText(this.t('modal.saveQueue'))
					.setCta()
					.onClick(() => this.handleSubmit('queue'))
			);

		// "关闭" 按钮 / "Close" button
		new Setting(buttonRow)
			.addButton(btn =>
				btn
					.setButtonText(this.t('modal.cancel'))
					.onClick(() => this.close())
			);

		// 键盘快捷键 / Keyboard shortcut: Enter → 保存到队列
		textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				// Cmd/Ctrl+Enter → 立即处理（桌面端）/ Process now (desktop)
				if (Platform.isDesktop) {
					this.handleSubmit('processNow');
				}
			} else if (e.key === 'Enter' && !e.shiftKey) {
				// Enter → 保存到队列 / Save to queue
				e.preventDefault();
				this.handleSubmit('queue');
			}
		});
	}

	/**
	 * 提交处理 / Handle submission
	 */
	private async handleSubmit(mode: 'queue' | 'processNow'): Promise<void> {
		const text = this.textarea.value.trim();
		if (!text) {
			this.close();
			return;
		}

		this.close();
		await this.onSave(text, mode);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
