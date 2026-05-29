/**
 * 队列管理器：每条目一个独立 JSON 文件
 * Queue manager: one JSON file per entry
 *
 * 文件命名 / File naming: {outputFolder}/toBeSaved_{createdAt}_{id}.json
 * 独立文件消除多端同步时的 TOCTOU 竞争
 * Individual files eliminate TOCTOU race conditions during multi-device sync
 */

import type { Vault } from 'obsidian';
import type { QueueEntry } from './types';

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
	 * 从文件名解析 entry ID / Parse entry ID from file name
	 */
	private parseIdFromFileName(fileName: string): string | null {
		if (!fileName.startsWith(QUEUE_PREFIX) || !fileName.endsWith(QUEUE_SUFFIX)) return null;
		const inner = fileName.slice(QUEUE_PREFIX.length, -QUEUE_SUFFIX.length);
		// 格式: 20260529T143052_uuid → 取最后一个 _ 之后的部分
		const lastUnderscore = inner.lastIndexOf('_');
		if (lastUnderscore < 0) return null;
		return inner.slice(lastUnderscore + 1);
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
	 * 读取所有待处理条目（按创建时间排序）/ Read all pending entries (ordered by creation time)
	 */
	async getPendingEntries(): Promise<QueueEntry[]> {
		await this.ensureDir();

		const files = await this.vault.adapter.list(this.outputFolder);
		const queueFiles = files.files
			.filter(f => {
				const name = f.split('/').pop() || '';
				return name.startsWith(QUEUE_PREFIX) && name.endsWith(QUEUE_SUFFIX);
			})
			.sort();

		const entries: QueueEntry[] = [];
		for (const filePath of queueFiles) {
			try {
				const raw = await this.vault.adapter.read(filePath);
				if (!raw.trim()) continue;
				const entry: unknown = JSON.parse(raw);
				if (QueueManager.isQueueEntry(entry)) {
					entries.push(entry);
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
	 * 按 ID 删除条目 / Remove entry by ID
	 */
	async removeEntry(id: string): Promise<void> {
		await this.ensureDir();
		const files = await this.vault.adapter.list(this.outputFolder);
		for (const filePath of files.files) {
			const name = filePath.split('/').pop() || '';
			const entryId = this.parseIdFromFileName(name);
			if (entryId === id) {
				await this.vault.adapter.remove(filePath);
				return;
			}
		}
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
