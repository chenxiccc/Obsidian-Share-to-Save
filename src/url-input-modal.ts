/**
 * URL 输入模态框：用户粘贴分享文本，提取 URL 后写入队列并立即处理
 * URL input modal: user pastes share text, extracts URL, writes to queue and processes immediately
 */

import { Modal, App, ButtonComponent } from 'obsidian';
import type { Translator } from './i18n';
import { extractUrl } from './url-extractor';

export class UrlInputModal extends Modal {
	private textarea!: HTMLTextAreaElement;

	constructor(
		app: App,
		private t: Translator,
		private onSave: (text: string) => Promise<void>,
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
				rows: '8',
			},
			cls: 'sts-url-textarea',
		});
		this.textarea = textareaEl;

		// 自动聚焦 / Auto focus
		setTimeout(() => textareaEl.focus(), 50);

		// 底部"立即保存"按钮 / Bottom "Save now" button
		const buttonRow = contentEl.createDiv({ cls: 'sts-button-row' });
		new ButtonComponent(buttonRow)
			.setButtonText(this.t('modal.saveNow'))
			.setCta()
			.onClick(() => this.handleSubmit());

		// Enter 提交 / Enter to submit
		textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSubmit();
			}
		});
	}

	private async handleSubmit(): Promise<void> {
		const text = this.textarea.value.trim();
		if (!text) {
			this.close();
			return;
		}
		this.close();
		await this.onSave(text);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
