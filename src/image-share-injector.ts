/**
 * 图片分享菜单注入器：在 Obsidian 手机端图片分享弹窗中注入"保存图片"按钮
 * Image share menu injector: inject "Save Image" button into Obsidian mobile image share dialog
 *
 * 通过 Hook shareReceiver.handleShareFiles 捕获分享文件数据，
 * MutationObserver 检测弹窗出现后，在"取消"按钮上方注入自定义按钮。
 *
 * Hooks shareReceiver.handleShareFiles to capture shared file data,
 * MutationObserver detects dialog appearance, injects custom button above "Cancel".
 *
 * 文本分享菜单继续由 ShareMenuInjector 独立处理（DOM 选择器方案）。
 * Text share menu continues to be handled independently by ShareMenuInjector (DOM selector approach).
 */

import { setIcon, Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { Translator } from './i18n';
import { showNotice } from './notice-utils';

/** 注入按钮 CSS 类名 / Injected button CSS class */
const IMAGE_BUTTON_CLASS = 'share-to-save-image-action';

/** shareReceiver 的文件对象类型 / File object type from shareReceiver */
interface SharedFile {
	name?: string;
	uri: string;
}

/** shareReceiver 原型上我们需要的接口 / Interface for the shareReceiver prototype methods we need */
interface ShareReceiverProto {
	handleShareFiles(files: SharedFile[]): void;
}

/** Capacitor 桥接对象接口（手机端运行时全局）/ Capacitor bridge interface (mobile runtime global) */
interface CapacitorBridge {
	convertFileSrc(uri: string): string;
}

/** 扩展 Window 类型 / Extend Window type */
declare global {
	interface Window {
		Capacitor?: CapacitorBridge;
	}
}

/** shareReceiver 实例上我们需要的接口 / Interface for shareReceiver instance */
interface ShareReceiverInstance {
	handleShareText?: (text: string) => void;
	handleShareFiles?: (files: SharedFile[]) => void;
}

export class ImageShareMenuInjector {
	/** 当前待处理的分享文件 / Currently pending shared files */
	private pendingFiles: SharedFile[] = [];
	/** MutationObserver 实例 / MutationObserver instance */
	private observer: MutationObserver | null = null;
	/** 原始 handleShareFiles 方法 / Original handleShareFiles method */
	private origHandleShareFiles: ((files: SharedFile[]) => void) | null = null;
	/** 当前注入的菜单元素（用于 removedNodes 匹配）/ Currently injected menu element (for removedNodes matching) */
	private injectedMenu: HTMLElement | null = null;

	constructor(
		private app: App,
		private getOutputFolder: () => string,
		private t: Translator,
	) {}

	/**
	 * 启动注入器：Hook 原型方法 + 启动 MutationObserver
	 * Start injector: Hook prototype method + start MutationObserver
	 */
	start(): void {
		if (!Platform.isMobile) return;

		this.hookShareReceiver();
		this.startObserver();
	}

	/**
	 * 停止注入器：恢复原型 + 断开 observer + 清理 DOM 残留
	 * Stop injector: Restore prototype + disconnect observer + clean up DOM remnants
	 */
	stop(): void {
		// 恢复原型方法 / Restore prototype method
		if (this.origHandleShareFiles) {
			try {
				const sr = (this.app as App & { shareReceiver?: ShareReceiverInstance }).shareReceiver;
				if (sr) {
					const proto = Object.getPrototypeOf(sr) as ShareReceiverProto;
					proto.handleShareFiles = this.origHandleShareFiles;
				}
			} catch {
				// 原型恢复失败不影响卸载 / Prototype restore failure doesn't block unload
			}
			this.origHandleShareFiles = null;
		}

		this.observer?.disconnect();
		this.observer = null;

		// 清理残留注入按钮 / Clean up residual injected buttons
		if (typeof activeDocument !== 'undefined') {
			activeDocument.querySelectorAll(`.${IMAGE_BUTTON_CLASS}`).forEach(el => el.remove());
		}
	}

	// ─── Hook 分享接收器 / Hook share receiver ──────────────────────────────

	/**
	 * Hook shareReceiver 原型上的 handleShareFiles 方法
	 * Hook the handleShareFiles method on shareReceiver prototype
	 */
	private hookShareReceiver(): void {
		const sr = (this.app as App & { shareReceiver?: ShareReceiverInstance }).shareReceiver;
		if (!sr) {
			console.debug('Share to Save: shareReceiver not found, image share hook skipped');
			return;
		}

		const proto = Object.getPrototypeOf(sr) as ShareReceiverProto;
		if (!proto.handleShareFiles) {
			console.debug('Share to Save: handleShareFiles not found on prototype, image share hook skipped');
			return;
		}

		const descriptor = Object.getOwnPropertyDescriptor(proto, 'handleShareFiles');
		if (!descriptor?.value) return;
		this.origHandleShareFiles = descriptor.value;

		proto.handleShareFiles = ((ctx) => {
			return function (this: ShareReceiverInstance, files: SharedFile[]) {
				ctx.pendingFiles = files;
				ctx.injectedMenu = null;
				return ctx.origHandleShareFiles!.call(this, files);
			};
		})(this);
	}

	// ─── MutationObserver ──────────────────────────────────────────────────

	/**
	 * 启动 MutationObserver，监听 body 直接子级的 .menu 增删
	 * Start MutationObserver, watching .menu additions/removals as direct children of body
	 */
	private startObserver(): void {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node.instanceOf(HTMLElement) && node.matches('body > .menu')) {
						this.onMenuAdded(node);
					}
				}
				for (const node of Array.from(mutation.removedNodes)) {
					if (node.instanceOf(HTMLElement) && node.matches('.menu')) {
						this.onMenuRemoved(node);
					}
				}
			}
		});

		this.observer.observe(activeDocument.body, {
			childList: true,
			subtree: false,
		});
	}

	/**
	 * 检测到新增 .menu 元素 / A new .menu element was detected
	 */
	private onMenuAdded(menu: HTMLElement): void {
		if (this.pendingFiles.length === 0) return;
		if (menu.querySelector('[data-section]')) return;
		if (!menu.querySelector('.menu-item.is-label')) return;
		if (this.injectedMenu === menu) return;

		this.injectButton(menu);
		this.injectedMenu = menu;
	}

	/**
	 * 检测到 .menu 元素被移除 / A .menu element was removed
	 */
	private onMenuRemoved(menu: HTMLElement): void {
		if (menu === this.injectedMenu) {
			this.pendingFiles = [];
			this.injectedMenu = null;
		}
	}

	// ─── 按钮注入 / Button injection ──────────────────────────────────────

	/**
	 * 向图片分享菜单注入"保存图片"按钮
	 * Inject "Save Image" button into image share menu
	 */
	private injectButton(menu: HTMLElement): void {
		const groups = menu.querySelectorAll('.menu-group');
		if (groups.length < 2) return;

		const actionGroup = groups[1];
		if (!actionGroup?.instanceOf(HTMLElement)) return;

		const tappableItems = actionGroup.querySelectorAll('.menu-item.tappable');
		if (tappableItems.length === 0) return;
		const cancelBtn = tappableItems[tappableItems.length - 1] as HTMLElement;

		const saveBtn = activeDocument.createElement('div');
		saveBtn.className = `menu-item tappable ${IMAGE_BUTTON_CLASS}`;

		const iconEl = saveBtn.createEl('div', { cls: 'menu-item-icon' });
		setIcon(iconEl, 'cloud-download');

		const titleEl = saveBtn.createEl('div', { cls: 'menu-item-title' });
		titleEl.setText(this.t('menu.saveImage'));

		saveBtn.addEventListener('click', () => {
			this.dismissMenu(menu);
			void this.saveFiles();
		});

		cancelBtn.before(saveBtn);
	}

	// ─── 弹窗关闭 / Dialog dismissal ──────────────────────────────────────

	/**
	 * 关闭图片分享弹窗（点击取消按钮）
	 * Dismiss image share dialog (click cancel button)
	 */
	private dismissMenu(menu: HTMLElement): void {
		const groups = menu.querySelectorAll('.menu-group');
		if (groups.length < 2) return;

		const actionGroup = groups[1];
		if (!actionGroup?.instanceOf(HTMLElement)) return;

		const tappableItems = actionGroup.querySelectorAll('.menu-item.tappable');
		if (tappableItems.length === 0) return;

		const cancelBtn = tappableItems[tappableItems.length - 1] as HTMLElement;
		cancelBtn.click();
	}

	// ─── 文件保存 / File saving ───────────────────────────────────────────

	/**
	 * 保存所有待处理文件到 output 文件夹根目录
	 * Save all pending files to output folder root directory
	 */
	private async saveFiles(): Promise<void> {
		const files = this.pendingFiles;
		this.pendingFiles = [];

		const outputFolder = this.getOutputFolder();

		try {
			const dirExists = await this.app.vault.adapter.exists(outputFolder);
			if (!dirExists) {
				await this.app.vault.adapter.mkdir(outputFolder);
			}
		} catch {
			showNotice(this.t('notice.imageFailed'), 5000);
			return;
		}

		let okCount = 0;
		let failCount = 0;
		const savedNames: string[] = [];

		for (const file of files) {
			try {
				const filename = extractName(file);
				const uniquePath = await this.resolveUniquePath(`${outputFolder}/${filename}`);

				const fileUrl = window.Capacitor?.convertFileSrc
					? window.Capacitor.convertFileSrc(file.uri)
					: file.uri;

				const response = await window.fetch(fileUrl);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				const buffer = await response.arrayBuffer();

				await this.app.vault.createBinary(uniquePath, buffer);
				okCount++;
				savedNames.push(filename);
			} catch (err) {
				failCount++;
				console.debug(`Share to Save: 图片保存失败 / image save failed: ${file.name || file.uri}`, err);
			}
		}

		if (failCount === 0) {
			if (okCount === 1 && savedNames.length === 1) {
				showNotice(this.t('notice.imageSavedName', { name: savedNames[0]! }));
			} else {
				showNotice(this.t('notice.imagesSaved', { count: String(okCount) }));
			}
		} else if (okCount === 0) {
			showNotice(this.t('notice.imageFailed'), 5000);
		} else {
			showNotice(this.t('notice.imageSavedPartial', { ok: String(okCount), fail: String(failCount) }), 5000);
		}
	}

	/**
	 * 解析不冲突的文件路径（已存在则加 _1, _2 后缀）
	 * Resolve a non-conflicting file path (append _1, _2 suffix if exists)
	 */
	private async resolveUniquePath(targetPath: string): Promise<string> {
		const exists = await this.app.vault.adapter.exists(targetPath);
		if (!exists) return targetPath;

		const lastDot = targetPath.lastIndexOf('.');
		const base = lastDot > 0 ? targetPath.substring(0, lastDot) : targetPath;
		const ext = lastDot > 0 ? targetPath.substring(lastDot) : '';

		let counter = 1;
		let candidate = '';
		do {
			candidate = `${base}_${counter}${ext}`;
			counter++;
		} while (await this.app.vault.adapter.exists(candidate));

		return candidate;
	}
}

// ─── 工具函数 / Utility functions ───────────────────────────────────────

/**
 * 从分享文件对象中提取文件名
 * Extract filename from shared file object
 */
function extractName(file: SharedFile): string {
	if (file.name) return file.name;

	const parts = file.uri.split('/');
	const lastPart = parts[parts.length - 1];
	if (lastPart) return lastPart;

	return 'image.png';
}
