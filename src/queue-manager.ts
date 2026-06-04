/**
 * 队列管理器：每条目一个独立 JSON 文件
 * Queue manager: one JSON file per entry
 *
 * 文件命名 / File naming: {outputFolder}/toBeSaved_{createdAt}_{id}.json
 * 独立文件消除多端同步时的 TOCTOU 竞争
 * Individual files eliminate TOCTOU race conditions during multi-device sync
 */

import type { Vault } from 'obsidian';
import type { QueueEntry, QueueEntryWithPath } from './types';

/** 队列文件名前缀 / Queue file prefix */
const QUEUE_PREFIX = 'toBeSaved_';
/** 队列文件名后缀 / Queue file suffix */
const QUEUE_SUFFIX = '.json';

export class QueueManager {
	private readonly outputFolder: string;

	constructor(
		private vault: Vault,
		outputFolder: string,
	) {
		this.outputFolder = outputFolder;
	}

	/**
	 * 构建队列文件名 / Build queue file name
	 * 格式 / Format: toBeSaved_{createdAt}_{id}.json
	 */
	private buildFileName(entry: QueueEntry): string {
		// 紧凑 ISO: 2026-05-29T14:30:52.000Z → 20260529T143052
		const compact = entry.createdAt
			.replace(/-/g, '')
			.replace(/:/g, '')
			.replace(/\.\d{3}Z?/, '');
		return `${QUEUE_PREFIX}${compact}_${entry.id}${QUEUE_SUFFIX}`;
	}

	/**
	 * 确保输出目录存在 / Ensure output directory exists
	 */
	private async ensureDir(): Promise<void> {
		const exists = await this.vault.adapter.exists(this.outputFolder);
		if (!exists) {
			await this.vault.adapter.mkdir(this.outputFolder);
		}
	}

	/**
	 * 读取所有待处理条目（按创建时间排序），附带文件路径供后续删除
	 * Read all pending entries (ordered by creation time), with file path for later deletion
	 */
	async getPendingEntries(): Promise<QueueEntryWithPath[]> {
		await this.ensureDir();

		const files = await this.vault.adapter.list(this.outputFolder);
		const queueFiles = files.files
			.filter(f => {
				const name = f.split('/').pop() || '';
				return name.startsWith(QUEUE_PREFIX) && name.endsWith(QUEUE_SUFFIX);
			})
			.sort();

		const entries: QueueEntryWithPath[] = [];
		for (const filePath of queueFiles) {
			try {
				const raw = await this.vault.adapter.read(filePath);
				if (!raw.trim()) continue;
				const entry: unknown = JSON.parse(raw);
				if (QueueManager.isQueueEntry(entry)) {
					// 附带文件路径，后续直接用路径删除，避免文件名解析
					// Attach file path for direct deletion later, avoiding filename parsing
					entries.push({ ...entry, filePath });
				}
			} catch {
				// 损坏的文件跳过 / Skip corrupted files
			}
		}
		return entries;
	}

	/**
	 * 追加新条目 / Append new entry
	 */
	async appendEntry(entry: QueueEntry): Promise<void> {
		await this.ensureDir();
		const fileName = this.buildFileName(entry);
		const filePath = `${this.outputFolder}/${fileName}`;
		const json = JSON.stringify(entry);
		await this.vault.create(filePath, json);
	}

	/**
	 * 按文件路径删除条目 / Remove entry by file path
	 */
	async removeEntry(filePath: string): Promise<void> {
		await this.vault.adapter.remove(filePath);
	}

	/** 类型守卫 / Type guard */
	private static isQueueEntry(obj: unknown): obj is QueueEntry {
		if (!obj || typeof obj !== 'object') return false;
		const e = obj as Record<string, unknown>;
		return typeof e.id === 'string'
			&& typeof e.url === 'string'
			&& typeof e.source === 'string'
			&& typeof e.createdAt === 'string';
	}
}
