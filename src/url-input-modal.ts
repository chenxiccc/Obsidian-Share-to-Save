/**
 * URL 输入模态框：用户粘贴分享文本，校验 URL 格式后写入队列并立即处理
 * URL input modal: user pastes share text, validates URL format, then processes
 */

import { Modal, App, ButtonComponent } from 'obsidian';
import type { Translator } from './i18n';
import { extractUrl, isValidUrl } from './url-extractor';

export class UrlInputModal extends Modal {
	private textarea!: HTMLTextAreaElement;
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private t: Translator,
		private onSave: (text: string) => Promise<void>,
		private initialText: string = '',
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

		// 预填待处理 URL / Pre-fill pending URLs
		if (this.initialText) {
			textareaEl.value = this.initialText;
		}

		// 自动聚焦 / Auto focus
		setTimeout(() => textareaEl.focus(), 50);

		// 错误提示区（初始隐藏） / Error message area (initially hidden)
		this.errorEl = contentEl.createDiv({ cls: 'sts-url-error' });
		this.errorEl.style.display = 'none';

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

	/**
	 * 校验 + 提交 / Validate + submit
	 *
	 * 逐行处理：无 URL 的行静默跳过，提取到 URL 但格式无效则报错阻断
	 * Per-line: silently skip lines without URLs, error only when URL found but invalid
	 */
	private async handleSubmit(): Promise<void> {
		const text = this.textarea.value.trim();
		if (!text) {
			this.close();
			return;
		}

		// 逐行校验 / Validate per line
		const lines = text.split('\n');
		const errors: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim();
			if (!line) continue;

			const url = extractUrl(line);
			if (!url) continue; // 无 URL 的行静默跳过 / Silently skip lines without URLs

			if (!isValidUrl(url)) {
				errors.push(this.t('modal.invalidUrl', { line: String(i + 1), url }));
			}
		}

		// 存在格式无效的 URL → 显示错误，阻断提交 / Show errors and block submission
		if (errors.length > 0) {
			this.errorEl.textContent = errors.join('\n');
			this.errorEl.style.display = 'block';
			return;
		}

		// 全部校验通过 / All lines validated
		this.errorEl.style.display = 'none';
		this.close();
		await this.onSave(text);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
