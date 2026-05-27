/**
 * 分享菜单注入器：在 Obsidian 手机端分享菜单中注入自定义按钮
 * Share menu injector: inject custom button into Obsidian mobile share menu
 *
 * 通过 MutationObserver 监听 body 直接子级变化，
 * 使用 data-section 三元组 (title + options + danger) 精确识别分享菜单
 *
 * Uses MutationObserver to watch body direct children,
 * identifies share menu via data-section triple (title + options + danger)
 */

import { setIcon, Platform } from 'obsidian';
import type { Translator } from './i18n';
import { extractUrl } from './url-extractor';

/** 注入按钮的 CSS 类名 / CSS class name for injected button */
const BUTTON_CLASS = 'share-to-save-action';

export class ShareMenuInjector {
	private observer: MutationObserver | null = null;

	constructor(
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
					if (node instanceof HTMLElement && node.matches('body > div.menu')) {
						if (this.isShareMenu(node)) {
							this.injectButton(node);
						}
					}
				}
			}
		});

		this.observer.observe(document.body, {
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
		document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(el => el.remove());
	}

	/**
	 * 判断一个 .menu 元素是否是分享菜单
	 * Determine whether a .menu element is the share menu
	 */
	private isShareMenu(menu: HTMLElement): boolean {
		return (
			menu.parentElement === document.body &&
			menu.querySelector('[data-section="title"]') !== null &&
			menu.querySelector('[data-section="options"]') !== null &&
			menu.querySelector('[data-section="danger"]') !== null
		);
	}

	/**
	 * 向分享菜单注入自定义按钮
	 * Inject custom button into share menu
	 */
	private injectButton(menu: HTMLElement): void {
		// 防重复注入 / Prevent duplicate injection
		if (menu.querySelector(`.${BUTTON_CLASS}`)) {
			return;
		}

		// 查找 options 区域内的所有可点击项 / Find all tappable items in options section
		const optionItems = menu.querySelectorAll('.menu-item.tappable[data-section="options"]');
		if (optionItems.length === 0) return;

		// 在最后一个 options 项之后插入 / Insert after the last options item
		const lastOptionItem = optionItems[optionItems.length - 1] as HTMLElement;

		// 创建自定义按钮 / Create custom button
		const customBtn = document.createElement('div');
		customBtn.className = `menu-item tappable ${BUTTON_CLASS}`;
		customBtn.setAttribute('data-section', 'options');

		// 图标 / Icon
		const iconEl = customBtn.createEl('div', { cls: 'menu-item-icon' });
		setIcon(iconEl, 'cloud-download');

		// 标题文本 / Title text
		const titleEl = customBtn.createEl('div', { cls: 'menu-item-title' });
		titleEl.setText(this.t('menu.button'));

		// 插入到最后一个 option 之后 / Insert after last option
		lastOptionItem.after(customBtn);

		// 绑定点击事件 / Bind click event
		customBtn.addEventListener('click', () => {
			void this.handleClick(menu);
		});
	}

	/**
	 * 处理按钮点击 / Handle button click
	 */
	private async handleClick(menu: HTMLElement): Promise<void> {
		// 从 title 区域读取分享的 URL / Read shared URL from title section
		const titleEl = menu.querySelector('[data-section="title"] .menu-item-title');
		const sharedText = titleEl?.textContent?.trim() || '';

		// 提取 URL / Extract URL
		const url = extractUrl(sharedText);
		if (!url) {
			return;
		}

		// 关闭分享菜单（模拟点击取消按钮）/ Close share menu (simulate cancel button click)
		this.dismissMenu(menu);

		// 回调处理 URL / Callback to process URL
		await this.onUrlReceived(url);
	}

	/**
	 * 关闭分享菜单 / Dismiss share menu
	 */
	private dismissMenu(menu: HTMLElement): void {
		// 点击取消按钮来关闭菜单 / Click cancel button to close menu
		const cancelBtn = menu.querySelector('[data-section="danger"]') as HTMLElement | null;
		cancelBtn?.click();
	}
}
