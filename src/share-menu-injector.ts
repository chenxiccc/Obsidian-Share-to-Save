/**
 * 分享菜单注入器：在 Obsidian 手机端分享菜单中注入自定义按钮（保存文字 + 保存网页）
 * Share menu injector: inject custom buttons (Save Text + Save Webpage) into Obsidian mobile share menu
 *
 * 通过 MutationObserver 监听 body 直接子级变化，
 * 使用 data-section 三元组 (title + options + danger) 精确识别分享菜单
 *
 * Uses MutationObserver to watch body direct children,
 * identifies share menu via data-section triple (title + options + danger)
 *
 * 保存文字始终显示，保存网页仅在共享文本包含 URL 时显示
 * Save Text always shown, Save Webpage only shown when shared text contains a URL
 */

import { setIcon, Platform } from 'obsidian';
import type { Translator } from './i18n';
import { extractUrl } from './url-extractor';

/** 保存文字按钮 CSS 类名 / Save Text button CSS class */
const TEXT_BUTTON_CLASS = 'share-to-save-text-action';
/** 保存网页按钮 CSS 类名 / Save Webpage button CSS class */
const URL_BUTTON_CLASS = 'share-to-save-url-action';

export class ShareMenuInjector {
	private observer: MutationObserver | null = null;

	constructor(
		private onTextReceived: (text: string) => Promise<void>,
		private onUrlReceived: (url: string) => Promise<void>,
		private t: Translator,
	) {}

	/**
	 * 启动 MutationObserver / Start MutationObserver
	 */
	start(): void {
		if (!Platform.isMobile) return;

		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node.instanceOf(HTMLElement) && node.matches('body > div.menu')) {
						if (this.isShareMenu(node)) {
							this.injectButtons(node);
						}
					}
				}
			}
		});

		this.observer.observe(activeDocument.body, {
			childList: true,
			subtree: false, // 只监听 body 直接子级 / Only watch direct children of body
		});
	}

	/**
	 * 停止并清理 / Stop and cleanup
	 */
	stop(): void {
		this.observer?.disconnect();
		this.observer = null;
		// 清理所有已注入的按钮 / Clean up all injected buttons
		activeDocument.querySelectorAll(`.${TEXT_BUTTON_CLASS}`).forEach(el => el.remove());
		activeDocument.querySelectorAll(`.${URL_BUTTON_CLASS}`).forEach(el => el.remove());
	}

	/**
	 * 判断一个 .menu 元素是否是分享菜单
	 * Determine whether a .menu element is the share menu
	 */
	private isShareMenu(menu: HTMLElement): boolean {
		return (
			menu.parentElement === activeDocument.body &&
			menu.querySelector('[data-section="title"]') !== null &&
			menu.querySelector('[data-section="options"]') !== null &&
			menu.querySelector('[data-section="danger"]') !== null
		);
	}

	/**
	 * 向分享菜单注入两个自定义按钮（保存文字 + 保存网页）
	 * Inject two custom buttons into share menu (Save Text + Save Webpage)
	 *
	 * 保存文字始终显示。保存网页仅在共享文本包含 URL 时显示。
	 * Save Text always shown. Save Webpage only shown when shared text contains a URL.
	 */
	private injectButtons(menu: HTMLElement): void {
		// 防重复注入：以文字按钮类名做守卫 / Prevent duplicate injection: guard on text button class
		if (menu.querySelector(`.${TEXT_BUTTON_CLASS}`)) {
			return;
		}

		// ── 提前读取分享文本，判断是否包含 URL / Read shared text early to check for URL ──
		const titleEl = menu.querySelector('[data-section="title"] .menu-item-title');
		const sharedText = titleEl?.textContent?.trim() || '';
		const hasUrl = extractUrl(sharedText) !== null;

		// 查找 options 区域内所有可点击项 / Find all tappable items in options section
		const optionItems = menu.querySelectorAll('.menu-item.tappable[data-section="options"]');
		if (optionItems.length === 0) return;

		// 在最后一个 options 项之后插入 / Insert after the last options item
		const lastOptionItem = optionItems[optionItems.length - 1] as HTMLElement;

		// ── 创建保存文字按钮（始终显示）/ Create Save Text button (always shown) ──
		const textBtn = activeDocument.createElement('div');
		textBtn.className = `menu-item tappable ${TEXT_BUTTON_CLASS}`;
		textBtn.setAttribute('data-section', 'options');

		const textIconEl = textBtn.createEl('div', { cls: 'menu-item-icon' });
		setIcon(textIconEl, 'cloud-download');

		const textTitleEl = textBtn.createEl('div', { cls: 'menu-item-title' });
		textTitleEl.setText(this.t('menu.saveText'));

		textBtn.addEventListener('click', () => {
			void this.handleTextClick(menu, sharedText);
		});

		lastOptionItem.after(textBtn);

		// ── 仅当有 URL 时创建保存网页按钮 / Create Save Webpage button only when URL present ──
		if (hasUrl) {
			const urlBtn = activeDocument.createElement('div');
			urlBtn.className = `menu-item tappable ${URL_BUTTON_CLASS}`;
			urlBtn.setAttribute('data-section', 'options');

			const urlIconEl = urlBtn.createEl('div', { cls: 'menu-item-icon' });
			setIcon(urlIconEl, 'cloud-download');

			const urlTitleEl = urlBtn.createEl('div', { cls: 'menu-item-title' });
			urlTitleEl.setText(this.t('menu.saveWebpage'));

			urlBtn.addEventListener('click', () => {
				void this.handleUrlClick(menu, sharedText);
			});

			textBtn.after(urlBtn);
		}
	}

	/**
	 * 保存文字按钮点击 / Save Text button click
	 */
	private async handleTextClick(menu: HTMLElement, sharedText: string): Promise<void> {
		if (!sharedText) {
			return;
		}
		this.dismissMenu(menu);
		await this.onTextReceived(sharedText);
	}

	/**
	 * 保存网页按钮点击 / Save Webpage button click
	 */
	private async handleUrlClick(menu: HTMLElement, sharedText: string): Promise<void> {
		const url = extractUrl(sharedText);
		if (!url) {
			return;
		}
		this.dismissMenu(menu);
		await this.onUrlReceived(url);
	}

	/**
	 * 关闭分享菜单 / Dismiss share menu
	 */
	private dismissMenu(menu: HTMLElement): void {
		// 点击取消按钮来关闭菜单 / Click cancel button to close menu
		const cancelBtn = menu.querySelector('[data-section="danger"]');
		if (cancelBtn instanceof HTMLElement) {
			cancelBtn.click();
		}
	}
}
