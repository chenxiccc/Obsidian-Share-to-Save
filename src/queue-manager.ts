/**
 * tobesave.json 队列管理器
 * Queue file CRUD with atomic I/O
 *
 * 文件路径可在设置中配置 / File path configurable via settings: vault/{outputFolder}/tobesave.json or plugin dir
 */

import type { Vault } from 'obsidian';
import type { QueueEntry, QueueFile, QueueStatus, QueueFileLocation } from './types';

/** tobesave.json 文件名 / Queue file name */
const QUEUE_FILE = 'tobesave.json';

export class QueueManager {
	private readonly queueDir: string;
	private readonly queuePath: string;

	constructor(
		private vault: Vault,
		private pluginId: string,
		private queueFileLocation: QueueFileLocation,
		private outputFolder: string,
	) {
		if (queueFileLocation === 'vault') {
			// 笔记库文件夹 / Vault folder: {outputFolder}/tobesave.json
			this.queueDir = outputFolder;
			this.queuePath = `${outputFolder}/${QUEUE_FILE}`;
		} else {
			// 插件安装目录 / Plugin directory: .obsidian/plugins/{pluginId}/tobesave.json
			this.queueDir = `${vault.configDir}/plugins/${pluginId}`;
			this.queuePath = `${this.queueDir}/${QUEUE_FILE}`;
		}
	}

	/** 获取队列文件完整路径 / Get queue file full path */
	get filePath(): string {
		return this.queuePath;
	}

	/** 获取队列文件所在目录 / Get queue file directory */
	get fileDir(): string {
		return this.queueDir;
	}

	/**
	 * 读取全部队列条目
	 * Read all queue entries
	 */
	async readAll(): Promise<QueueFile> {
		try {
			if (!(await this.vault.adapter.exists(this.queuePath))) {
				return [];
			}
			const raw = await this.vault.adapter.read(this.queuePath);
			if (!raw.trim()) {
				return [];
			}
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed as QueueFile;
		} catch {
			return [];
		}
	}

	/**
	 * 读取所有 status='pending' 的条目
	 * Read all pending entries
	 */
	async getPendingEntries(): Promise<QueueEntry[]> {
		const all = await this.readAll();
		return all.filter(e => e.status === 'pending');
	}

	/**
	 * 追加新条目到队列末尾
	 * Append a new entry to the end of the queue
	 */
	async appendEntry(entry: QueueEntry): Promise<void> {
		const entries = await this.readAll();
		entries.push(entry);
		await this.atomicWrite(entries);
	}

	/**
	 * 更新条目的状态（和可选的错误信息）
	 * Update entry status (and optional error message)
	 */
	async updateStatus(
		id: string,
		status: QueueStatus,
		error?: string,
	): Promise<void> {
		const entries = await this.readAll();
		const entry = entries.find(e => e.id === id);
		if (!entry) {
			return;
		}
		entry.status = status;
		if (error !== undefined) {
			entry.error = error;
		}
		await this.atomicWrite(entries);
	}

	/**
	 * 更新条目的标题（下载完成后）
	 * Update entry title (after download completes)
	 */
	async updateTitle(id: string, title: string): Promise<void> {
		const entries = await this.readAll();
		const entry = entries.find(e => e.id === id);
		if (!entry) {
			return;
		}
		entry.title = title;
		await this.atomicWrite(entries);
	}

	/**
	 * 从队列中移除条目（处理成功后）
	 * Remove entry from queue (after successful processing)
	 */
	async removeEntry(id: string): Promise<void> {
		const entries = await this.readAll();
		const filtered = entries.filter(e => e.id !== id);
		if (filtered.length === entries.length) {
			return; // 未找到，无需写入 / Not found, no write needed
		}
		await this.atomicWrite(filtered);
	}

	/**
	 * 获取文件大小（字节），文件不存在时返回 -1
	 * Get file size in bytes, return -1 if file doesn't exist
	 */
	async getFileSize(): Promise<number> {
		try {
			const stat = await this.vault.adapter.stat(this.queuePath);
			return stat?.size ?? -1;
		} catch {
			return -1;
		}
	}

	/**
	 * 检查文件是否存在
	 * Check if queue file exists
	 */
	async fileExists(): Promise<boolean> {
		return this.vault.adapter.exists(this.queuePath);
	}

	/**
	 * 原子写入：确保目录存在后覆盖写入整个文件
	 * Atomic write: ensure directory exists then overwrite the entire file
	 */
	private async atomicWrite(entries: QueueEntry[]): Promise<void> {
		// 确保目录存在 / Ensure directory exists
		const dirExists = await this.vault.adapter.exists(this.queueDir);
		if (!dirExists) {
			await this.vault.adapter.mkdir(this.queueDir);
		}

		const json = JSON.stringify(entries, null, 2);
		await this.vault.adapter.write(this.queuePath, json);
	}
}
