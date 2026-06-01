/**
 * 文件监听器：定时轮询队列目录，检测新条目后触发下载
 * File watcher: poll queue directory periodically, trigger download on new entries
 *
 * 轮询间隔通过 getter 函数动态获取，设置变更即时生效
 * Poll interval dynamically obtained via getter function, setting changes take immediate effect
 *
 * 仅在桌面端运行 / Desktop only
 */

import { Notice } from 'obsidian';
import type { QueueManager } from './queue-manager';
import type { Downloader } from './downloader';

export class FileWatcher {
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private isProcessing = false; // 防止并发处理 / Prevent concurrent processing
	private currentIntervalMs: number;

	/** 处理状态变化回调，用于驱动 UI 更新 / Callback for processing state change, drives UI updates */
	onProcessingChange: ((processing: boolean) => void) | null = null;

	constructor(
		private queueManager: QueueManager,
		private downloader: Downloader,
		private debugLog: (msg: string) => void,
		private getPollIntervalMs: () => number,  // 动态配置，零耦合 / Dynamic config, zero coupling
	) {
		this.currentIntervalMs = getPollIntervalMs();
	}

	/**
	 * 启动定时轮询 / Start scheduled polling
	 */
	start(): void {
		this.scheduleNext();
		this.debugLog(`FileWatcher 已启动，间隔 ${this.currentIntervalMs}ms / FileWatcher started, ${this.currentIntervalMs}ms interval`);
	}

	/**
	 * 停止轮询 / Stop polling
	 */
	stop(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		this.debugLog('FileWatcher 已停止 / FileWatcher stopped');
	}

	/**
	 * 立即触发处理（跳过等待，仍检查并发）
	 * Immediately trigger processing (skip wait, still check concurrency)
	 */
	async processNow(): Promise<void> {
		if (this.isProcessing) {
			this.debugLog('正在处理中，跳过本次触发 / Already processing, skipping');
			return;
		}
		// 取消当前定时器，处理后重新调度 / Cancel current timer, reschedule after processing
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		await this.check();
		this.scheduleNext();
	}

	/**
	 * 调度下一次轮询 / Schedule next poll
	 */
	private scheduleNext(): void {
		const interval = this.getPollIntervalMs();
		this.currentIntervalMs = interval;
		this.timerId = setTimeout(() => {
			this.timerId = null;
			void this.check().then(() => this.scheduleNext());
		}, interval);
	}

	/**
	 * 单轮检测 / Single check cycle
	 */
	private async check(): Promise<void> {
		if (this.isProcessing) return;

		try {
			const entries = await this.queueManager.getPendingEntries();
			if (entries.length === 0) return;

			this.isProcessing = true;
			this.onProcessingChange?.(true);
			this.debugLog(`发现 ${entries.length} 条待处理 / Found ${entries.length} pending entries`);

			for (const entry of entries) {
				// delete on start：处理前删除文件，防止重复处理
				// delete on start: remove file before processing to prevent re-processing
				await this.queueManager.removeEntry(entry.id);

				try {
					const result = await this.downloader.processUrl(entry.url, entry.id);
					if (result.success) {
						new Notice(`已保存: ${result.title ?? entry.url}`);
					} else {
						await this.downloader.saveFailedNote(entry.url);
						this.debugLog(`提取失败 / Extraction failed: ${entry.url}`);
					}
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					this.debugLog(`处理异常 / Processing exception: ${entry.url} - ${errMsg}`);
					await this.downloader.saveFailedNote(entry.url);
				}
			}
		} catch (err) {
			this.debugLog(`轮询检查异常 / Polling check error: ${String(err)}`);
		} finally {
			this.isProcessing = false;
			this.onProcessingChange?.(false);
		}
	}
}
