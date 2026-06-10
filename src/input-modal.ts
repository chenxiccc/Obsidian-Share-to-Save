/**
 * 输入模态框：用户粘贴文本，可选择"保存文字"或"保存网页"
 * Input modal: user pastes text, choose "Save Text" or "Save Webpage"
 */

import { Modal, App, setIcon } from 'obsidian';
import type { Translator } from './i18n';
import { extractUrl, isValidUrl } from './url-extractor';

export class InputModal extends Modal {
	private textarea!: HTMLTextAreaElement;
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private t: Translator,
		private onSaveText: (text: string) => Promise<void>,
		private onSaveUrl: (text: string) => Promise<void>,
		private initialText: string = '',
		private onCloseCallback?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('sts-input-modal');

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
			cls: 'sts-input-textarea',
		});
		this.textarea = textareaEl;

		if (this.initialText) {
			textareaEl.value = this.initialText;
		}
		window.setTimeout(() => textareaEl.focus(), 50);

		// ── 错误提示 / Error hint ──
		this.errorEl = contentEl.createDiv({ cls: 'sts-input-error' });
		this.errorEl.addClass('sts-hidden');

		// ── 底部按钮 / Bottom buttons ──
		const buttonRow = contentEl.createDiv({ cls: 'sts-button-row' });

		// 保存文字（左，次要按钮）/ Save Text (left, secondary button)
		const textBtn = buttonRow.createDiv({ cls: 'sts-save-btn sts-save-text-btn' });
		textBtn.setText(this.t('modal.saveText'));
		textBtn.addEventListener('click', () => { void this.handleSaveText(); });

		// 保存网页（右，主按钮）/ Save Webpage (right, primary button)
		const urlBtn = buttonRow.createDiv({ cls: 'sts-save-btn sts-save-url-btn' });
		urlBtn.setText(this.t('modal.saveWebpage'));
		urlBtn.addEventListener('click', () => { void this.handleSubmit(); });

		// Enter 提交 → 保存网页 / Enter submits → Save Webpage
		textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.handleSubmit();
			}
		});
	}

	/**
	 * 保存文字：无需校验 URL，直接保存文本内容
	 * Save text: no URL validation, save text directly
	 */
	private async handleSaveText(): Promise<void> {
		const text = this.textarea.value.trim();
		if (!text) {
			this.close();
			return;
		}
		this.errorEl.addClass('sts-hidden');
		this.close();
		await this.onSaveText(text);
	}

	/**
	 * 保存网页：校验 URL 格式后提交
	 * Save webpage: validate URL format then submit
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
		await this.onSaveUrl(text);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.onCloseCallback?.();
	}
}
