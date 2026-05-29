/**
 * 文件监听器：定时轮询 tobesave.json，检测新内容后触发下载
 * File watcher: poll tobesave.json periodically, trigger download on new content
 *
 * 轮询间隔 1 小时 / Polling interval: 1 hour
 * 双重稳定性检测：连续 2 次读取文件大小相同才认为写入完成
 * Double stability check: file size must be identical across 2 consecutive reads
 *
 * 仅在桌面端运行 / Desktop only
 */

import { Notice } from 'obsidian';
import type { QueueManager } from './queue-manager';
import type { Downloader } from './downloader';

/** 轮询间隔（1 小时）/ Polling interval (1 hour) */
const POLL_INTERVAL_MS = 3_600_000;
/** 稳定性检测间隔 / Stability check gap */
const STABILITY_GAP_MS = 2_000;

/** 简单的 sleep / Simple sleep */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class FileWatcher {
	private pollIntervalId: ReturnType<typeof setInterval> | null = null;
	private isProcessing = false; // 防止并发处理 / Prevent concurrent processing

	constructor(
		private queueManager: QueueManager,
		private downloader: Downloader,
		private debugLog: (msg: string) => void,
	) {}

	/**
	 * 启动定时轮询 / Start scheduled polling
	 */
	start(): void {
		this.pollIntervalId = setInterval(() => {
			this.check();
		}, POLL_INTERVAL_MS);
		this.debugLog('FileWatcher 已启动，间隔 1h / FileWatcher started, 1h interval');
	}

	/**
	 * 停止轮询 / Stop polling
	 */
	stop(): void {
		if (this.pollIntervalId !== null) {
			clearInterval(this.pollIntervalId);
			this.pollIntervalId = null;
		}
		this.debugLog('FileWatcher 已停止 / FileWatcher stopped');
	}

	/**
	 * 立即触发处理（跳过 1h 等待，仍执行稳定性检测）
	 * Immediately trigger processing (skip 1h wait, still perform stability check)
	 * 由 UrlInputModal 的"立即处理"按钮调用 / Called by UrlInputModal's "Process now" button
	 */
	async processNow(): Promise<void> {
		if (this.isProcessing) {
			this.debugLog('正在处理中，跳过本次触发 / Already processing, skipping');
			return;
		}
		await this.check();
	}

	/**
	 * 单轮检测 / Single check cycle
	 */
	private async check(): Promise<void> {
		try {
			// 文件不存在则跳过 / Skip if file doesn't exist
			const exists = await this.queueManager.fileExists();
			if (!exists) {
				return;
			}

			// 稳定性检测 / Stability check
			const size1 = await this.queueManager.getFileSize();
			await sleep(STABILITY_GAP_MS);
			const size2 = await this.queueManager.getFileSize();

			if (size1 !== size2) {
				this.debugLog(`文件大小不一致 (${size1} → ${size2})，文件可能仍在同步中 / File size unstable, may still be syncing`);
				return;
			}
			if (size1 <= 0) {
				return; // 空文件 / Empty file
			}

			this.debugLog(`文件稳定 (size=${size1})，开始处理 / File stable, starting processing`);
			await this.processPending();
		} catch (err) {
			this.debugLog(`轮询检查异常 / Polling check error: ${String(err)}`);
		}
	}

	/**
	 * 处理所有待处理条目 / Process all pending entries
	 */
	private async processPending(): Promise<void> {
		this.isProcessing = true;
		try {
			const entries = await this.queueManager.getPendingEntries();

			if (entries.length === 0) {
				return;
			}

			this.debugLog(`发现 ${entries.length} 条待处理 / Found ${entries.length} pending entries`);

			for (const entry of entries) {
				await this.queueManager.updateStatus(entry.id, 'processing');
				try {
					const result = await this.downloader.processUrl(entry.url, entry.id);
					if (result.success) {
						await this.queueManager.removeEntry(entry.id);
						new Notice(`已保存: ${result.title ?? entry.url}`);
					} else {
						// 提取失败：生成 save_failed 文件，从队列删除
						// Extraction failed: generate save_failed note, remove from queue
						await this.downloader.saveFailedNote(entry.url);
						await this.queueManager.removeEntry(entry.id);
						this.debugLog(`提取失败 / Extraction failed: ${entry.url}`);
					}
				} catch (err) {
					// 异常：同样生成 save_failed 文件，从队列删除
					// Exception: also generate save_failed note and remove from queue
					const errMsg = err instanceof Error ? err.message : String(err);
					this.debugLog(`处理异常 / Processing exception: ${entry.url} - ${errMsg}`);
					await this.downloader.saveFailedNote(entry.url);
					await this.queueManager.removeEntry(entry.id);
				}
			}
		} finally {
			this.isProcessing = false;
		}
	}
}
