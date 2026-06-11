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
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
				const sr = (this.app as any).shareReceiver;
				if (sr) {
					const proto = Object.getPrototypeOf(sr);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
	 *
	 * 在原方法被调用时缓存文件数据，然后由 MutationObserver 检测弹窗并注入按钮
	 * Caches file data when original method is called, then MutationObserver detects dialog and injects button
	 */
	private hookShareReceiver(): void {
		// shareReceiver 是 Obsidian 内部 API，无公开类型定义 / Internal API, no public type
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
		const sr = (this.app as any).shareReceiver;
		if (!sr) {
			console.debug('Share to Save: shareReceiver not found, image share hook skipped');
			return;
		}

		const proto = Object.getPrototypeOf(sr);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		if (!proto.handleShareFiles) {
			console.debug('Share to Save: handleShareFiles not found on prototype, image share hook skipped');
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		this.origHandleShareFiles = proto.handleShareFiles;
		// Hook 闭包内 this 指向 shareReceiver 实例，必须用别名引用本类 / this in hook refers to shareReceiver, alias required
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		proto.handleShareFiles = function (files: SharedFile[]) {
			self.pendingFiles = files;
			self.injectedMenu = null;
			// 调用原始方法，同步创建 .menu 并插入 body
			// Call original method, synchronously creates .menu and inserts into body
			return self.origHandleShareFiles!.call(this, files);
		};
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
			subtree: false, // 只看 body 直接子级 / Only watch body direct children
		});
	}

	/**
	 * 检测到新增 .menu 元素 / A new .menu element was detected
	 */
	private onMenuAdded(menu: HTMLElement): void {
		// 守卫 1: 不是图片分享触发的 / Guard 1: not triggered by image share
		if (this.pendingFiles.length === 0) return;

		// 守卫 2: 有 data-section 说明是文本分享菜单（由 ShareMenuInjector 处理）
		// Guard 2: has data-section means it's a text share menu (handled by ShareMenuInjector)
		if (menu.querySelector('[data-section]')) return;

		// 守卫 3: 没有 .menu-item.is-label 说明结构不符 / Guard 3: no .menu-item.is-label means wrong structure
		if (!menu.querySelector('.menu-item.is-label')) return;

		// 守卫 4: 已注入过 / Guard 4: already injected
		if (this.injectedMenu === menu) return;

		this.injectButton(menu);
		this.injectedMenu = menu;
	}

	/**
	 * 检测到 .menu 元素被移除 / A .menu element was removed
	 */
	private onMenuRemoved(menu: HTMLElement): void {
		if (menu === this.injectedMenu) {
			// 用户关闭了弹窗（点取消/导入/点击外部），清理状态
			// User dismissed dialog (cancel/import/tap outside), clean up state
			this.pendingFiles = [];
			this.injectedMenu = null;
		}
	}

	// ─── 按钮注入 / Button injection ──────────────────────────────────────

	/**
	 * 向图片分享菜单注入"保存图片"按钮
	 * Inject "Save Image" button into image share menu
	 *
	 * 插入位置：第二个 .menu-group 中，"取消"按钮之前
	 * Insert position: in the second .menu-group, before the "Cancel" button
	 */
	private injectButton(menu: HTMLElement): void {
		const groups = menu.querySelectorAll('.menu-group');
		if (groups.length < 2) return;

		const actionGroup = groups[1]; // 第二个 group 是 action buttons 区 / Second group is action buttons area
		if (!(actionGroup instanceof HTMLElement)) return;

		// 取消按钮是该 group 的最后一个 .menu-item.tappable
		// Cancel button is the last .menu-item.tappable in this group
		const tappableItems = actionGroup.querySelectorAll('.menu-item.tappable');
		if (tappableItems.length === 0) return;
		const cancelBtn = tappableItems[tappableItems.length - 1] as HTMLElement;

		// 创建"保存图片"按钮 / Create "Save Image" button
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

		// 插入到取消按钮之前 / Insert before cancel button
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
		if (!(actionGroup instanceof HTMLElement)) return;
		const tappableItems = actionGroup.querySelectorAll('.menu-item.tappable');
		if (tappableItems.length === 0) return;

		// 取消按钮始终是最后一个 tappable 项 / Cancel button is always the last tappable item
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
		this.pendingFiles = []; // 立即清空，防止重入 / Clear immediately to prevent re-entry

		const outputFolder = this.getOutputFolder();

		// 确保 output 目录存在 / Ensure output directory exists
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

				// Capacitor 是手机端运行时全局，用于桥接本地文件，无 TS 类型定义
				// Capacitor is a mobile runtime global for local file bridging, no TS type definitions
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
				const capacitor = (globalThis as any).Capacitor;
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
				const fileUrl = capacitor?.convertFileSrc
					? capacitor.convertFileSrc(file.uri)
					: file.uri;

				// 此处 fetch 访问的是 Capacitor 桥接的本地文件（content:// → localhost），非 HTTP 请求，不能用 requestUrl
				// This fetch accesses Capacitor-bridged local files (content:// → localhost), not an HTTP request — requestUrl won't work
				// eslint-disable-next-line no-restricted-globals
				const response = await fetch(fileUrl);
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

		// ── 通知 / Notification ──
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

		// 分离文件名和扩展名 / Split filename and extension
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
 *
 * 优先 file.name，回退到从 URI 末尾提取（与 Obsidian importFiles 源码逻辑一致）
 * Prefer file.name, fallback to extracting from URI tail (consistent with Obsidian importFiles source)
 */
function extractName(file: SharedFile): string {
	if (file.name) return file.name;

	// 从 content://.../filename.jpg 或 file:///.../filename.jpg 提取
	// Extract from content://.../filename.jpg or file:///.../filename.jpg
	const parts = file.uri.split('/');
	const lastPart = parts[parts.length - 1];
	if (lastPart) return lastPart;

	return 'image.png';
}
