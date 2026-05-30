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
		const { contentEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('sts-url-input-modal');

		// ── 标题 / Title ──
		titleEl.empty();
		const iconEl = titleEl.createSpan({ cls: 'sts-modal-title-icon' });
		setIcon(iconEl, 'cloud-download');
		titleEl.createSpan({ text: this.t('modal.title') });

		const settingsBtn = titleEl.createSpan({ cls: 'sts-modal-title-settings' });
		setIcon(settingsBtn, 'settings');
		settingsBtn.setAttribute('aria-label', this.t('modal.settings'));
		settingsBtn.addEventListener('click', () => {
			this.close();
			const setting = this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } };
			setting.setting.open();
			setting.setting.openTabById('share-to-save');
		});

		// ── 输入区 / Input area ──
		const textareaEl = contentEl.createEl('textarea', {
			attr: {
				placeholder: this.t('modal.placeholder'),
				rows: '4',
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
		this.errorEl.addClass('sts-hidden');

		// ── 底部按钮 / Bottom button ──
		const buttonRow = contentEl.createDiv({ cls: 'sts-button-row' });
		const saveBtn = buttonRow.createDiv({ cls: 'sts-save-btn' });
		saveBtn.setText(this.t('modal.saveNow'));
		saveBtn.addEventListener('click', () => { void this.handleSubmit(); });

		// Enter 提交 / Enter to submit
		textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.handleSubmit();
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
			this.errorEl.removeClass('sts-hidden');
			return;
		}

		this.errorEl.addClass('sts-hidden');
		this.close();
		await this.onSave(text);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
