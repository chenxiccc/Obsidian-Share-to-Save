/**
 * URL 输入模态框：用户粘贴分享文本，校验 URL 格式后写入队列并立即处理
 * URL input modal: user pastes share text, validates URL format, then processes
 */

import { Modal, App, setIcon } from 'obsidian';
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
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('sts-url-input-modal');

		// ── 标题：复用 Obsidian 原生 .modal-title，只改文字 / Title: reuse Obsidian native .modal-title ──
		titleEl.empty();
		titleEl.createSpan({ text: this.t('modal.title') });

		// ── 设置按钮：放在 modalEl 上，绝对定位到关闭按钮左侧 / Settings button: positioned left of close button ──
		const settingsBtn = modalEl.createDiv({ cls: 'sts-modal-settings' });
		setIcon(settingsBtn, 'settings');
		settingsBtn.setAttribute('aria-label', this.t('modal.settings'));
		settingsBtn.addEventListener('click', () => {
			this.close();
			// @ts-ignore - setting is available at runtime but not in public API
			this.app.setting.open();
			// @ts-ignore - openTabById is available at runtime
			this.app.setting.openTabById('share-to-save');
		});

		// ── 输入区 / Input area ──
		const textareaEl = contentEl.createEl('textarea', {
			attr: {
				placeholder: this.t('modal.placeholder'),
				rows: '8',
			},
			cls: 'sts-url-textarea',
		});
		this.textarea = textareaEl;

		if (this.initialText) {
			textareaEl.value = this.initialText;
		}
		setTimeout(() => textareaEl.focus(), 50);

		// ── 错误提示 / Error hint ──
		this.errorEl = contentEl.createDiv({ cls: 'sts-url-error' });
		this.errorEl.style.display = 'none';

		// ── 底部按钮 / Bottom button ──
		const buttonRow = contentEl.createDiv({ cls: 'sts-button-row' });
		const saveBtn = buttonRow.createDiv({ cls: 'sts-save-btn' });
		saveBtn.setText(this.t('modal.saveNow'));
		saveBtn.addEventListener('click', () => this.handleSubmit());

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

		const lines = text.split('\n');
		const errors: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim();
			if (!line) continue;

			const url = extractUrl(line);
			if (!url) continue;

			if (!isValidUrl(url)) {
				errors.push(this.t('modal.invalidUrl', { line: String(i + 1), url }));
			}
		}

		if (errors.length > 0) {
			this.errorEl.textContent = errors.join('\n');
			this.errorEl.style.display = 'block';
			return;
		}

		this.errorEl.style.display = 'none';
		this.close();
		await this.onSave(text);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
