/**
 * 通知工具：桌面端使用 Obsidian 原生 Notice，手机端使用气泡 toast
 * Notice utility: desktop delegates to Obsidian's native Notice, mobile uses bubble toast
 */

import { Notice, Platform } from 'obsidian';

/** 通知句柄，支持动态更新消息和手动隐藏 */
export interface ShowNotice {
	/** 更新已显示通知的消息文本 / Update the displayed message text */
	setMessage(message: string): void;
	/** 隐藏通知（触发退出动画）/ Hide the notice (triggers exit animation) */
	hide(): void;
}

/**
 * 显示通知。手机端渲染为右上角气泡 toast 替代 Obsidian 原生顶部黑条。
 * Show a notice. On mobile, renders a bubble-style toast instead of Obsidian's native top-bar.
 *
 * @param message  - 显示文本 / Display text
 * @param duration - 自动隐藏毫秒数（0 表示持续显示直到手动 hide）/ Auto-hide duration in ms (0 = persistent until hide())
 */
export function showNotice(message: string, duration = 2500): ShowNotice {
	if (!Platform.isMobile) {
		const notice = new Notice(message, duration);
		return {
			setMessage: (msg: string) => notice.setMessage(msg),
			hide: () => notice.hide(),
		};
	}

	// 移除已有 toast，避免堆叠 / Remove existing toast to prevent stacking
	const existing = document.querySelector('.sts-mobile-toast');
	if (existing) existing.remove();

	const toast = document.body.createDiv();
	toast.className = 'sts-mobile-toast';
	toast.textContent = message;

	let hideTimeout: number | null = null;

	const startHide = () => {
		if (toast.parentElement) {
			toast.classList.add('sts-mobile-toast-hiding');
			toast.addEventListener('animationend', () => toast.remove(), { once: true });
		}
	};

	if (duration > 0) {
		hideTimeout = window.setTimeout(startHide, duration);
	}

	return {
		setMessage: (msg: string) => {
			toast.textContent = msg;
		},
		hide: () => {
			if (hideTimeout) window.clearTimeout(hideTimeout);
			startHide();
		},
	};
}
