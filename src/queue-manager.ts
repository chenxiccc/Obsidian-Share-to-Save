/**
 * 队列管理器：每条目一个独立 JSON 文件
 * Queue manager: one JSON file per entry
 *
 * 文件命名 / File naming: {outputFolder}/toBeSaved_{createdAt}_{id}.json
 * 独立文件消除多端同步时的 TOCTOU 竞争
 * Individual files eliminate TOCTOU race conditions during multi-device sync
 *
 * getPendingEntries() 内部先调用 convertShareMenuNotes()，
 * 将分享菜单创建的 [标题](URL).md 文件自动转换为标准队列条目。
 * getPendingEntries() internally calls convertShareMenuNotes() first,
 * auto-converting share-menu-created .md files to standard queue entries.
 */

import type { Vault, MetadataCache } from 'obsidian';
import type { QueueEntry, QueueEntryWithPath } from './types';
import { extractUrls } from './url-extractor';

/** 队列文件名前缀 / Queue file prefix */
const QUEUE_PREFIX = 'toBeSaved_';
/** 队列文件名后缀 / Queue file suffix */
const QUEUE_SUFFIX = '.json';

export class QueueManager {
	constructor(
		private vault: Vault,
		/**
		 * 输出目录 getter：实时读取当前设置值，避免设置变更后仍写入旧目录
		 * Output folder getter: reads the current setting live, so changing it
		 * mid-session doesn't leave the queue writing to the stale folder
		 */
		private readonly getOutputFolder: () => string,
		/**
		 * 可选：用于内存查 frontmatter.sts_id，跳过已处理的 .md 文件，避免文件 I/O
		 * Optional: used to check frontmatter.sts_id in memory, skipping processed .md files
		 */
		private metadataCache?: MetadataCache,
	) {}

	/**
	 * 构建标准 QueueEntry 对象 / Build a standard QueueEntry object
	 */
	static buildEntry(url: string, source: QueueEntry['source']): QueueEntry {
		return {
			id: crypto.randomUUID(),
			url,
			source,
			createdAt: new Date().toISOString(),
		};
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
		// 顶部缓存一次，避免 exists 与 mkdir 两次 getter 读取间设置变更导致错位
		// Cache once up front so exists/mkdir see the same folder even if settings change mid-call
		const folder = this.getOutputFolder();
		const exists = await this.vault.adapter.exists(folder);
		if (!exists) {
			await this.vault.adapter.mkdir(folder);
		}
	}

	/**
	 * 读取所有待处理条目（按创建时间排序），附带文件路径供后续删除
	 * Read all pending entries (ordered by creation time), with file path for later deletion
	 *
	 * 内部先调用 convertShareMenuNotes() 将分享菜单创建的 .md 转为队列条目
	 * Internally calls convertShareMenuNotes() first to convert share-menu .md to queue entries
	 */
	async getPendingEntries(): Promise<QueueEntryWithPath[]> {
		const outputFolder = this.getOutputFolder();

		// 目录不存在说明无待处理任务，直接返回空数组，避免无谓创建空目录
		// Directory doesn't exist means no pending tasks, return early to avoid creating empty dir
		const dirExists = await this.vault.adapter.exists(outputFolder);
		if (!dirExists) return [];

		// 先列文件用于 md 检测 / List files for md detection
		const listing = await this.vault.adapter.list(outputFolder);
		await this.convertShareMenuNotes(listing.files);

		// 重新列出：convertShareMenuNotes 可能创建了新队列文件
		// Re-list: convertShareMenuNotes may have created new queue files
		const files = await this.vault.adapter.list(outputFolder);
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
					entries.push({ ...entry, filePath });
				}
			} catch {
				// 损坏的文件跳过 / Skip corrupted files
			}
		}
		return entries;
	}

	/**
	 * 将无 sts_id 的 .md 文件转换为标准队列条目
	 * Convert .md files without sts_id to standard queue entries
	 *
	 * 通过 frontmatter 中是否包含 sts_id 区分已处理文件和外来文件：
	 *   - metadataCache 命中且 frontmatter 有 sts_id → 跳过（0 I/O）
	 *   - metadataCache 未命中 → 读文件，正则检查 sts_id
	 *   - 无 sts_id → extractUrls() 提取 URL → 删 .md → 建 toBeSaved_*.json
	 *
	 * ★ 先删 .md 再建队列条目，防止中间崩溃导致下次重复处理
	 *
	 * @param filePaths 文件路径列表 / File paths from a single list() call
	 */
	private async convertShareMenuNotes(filePaths: string[]): Promise<void> {
		for (const filePath of filePaths) {
			if (!filePath.endsWith('.md')) continue;
			const fileName = filePath.split('/').pop() || filePath;

			try {
				// ── 守卫 1: metadataCache 已有 sts_id → 跳过（0 I/O）──
				if (this.metadataCache) {
					const cache = this.metadataCache.getCache(filePath);
					if (cache?.frontmatter && 'sts_id' in cache.frontmatter) {
						continue;
					}
				}

				// ── 守卫 2: 读文件 + 正则检测 sts_id → 跳过 ──
				const raw = await this.vault.adapter.read(filePath);
				if (!raw.trim()) continue;
				if (/^---[\s\S]*?\bsts_id\s*:[\s\S]*?^---/m.test(raw)) continue;

				// ── 守卫 3: 无可提取 URL → 跳过 ──
				const urls = extractUrls(raw);
				if (urls.length === 0) {
					console.debug(`Share to Save: 无 URL 跳过 / no URL skip: ${fileName}`);
					continue;
				}

				// ── 转换：先删 .md 再建队列条目 ──
				console.debug(`Share to Save: 转换 / converting: ${fileName} → ${urls.length} URL(s)`);
				await this.vault.adapter.remove(filePath);

				await Promise.all(
					urls.map(url => this.appendEntry(
						QueueManager.buildEntry(url, 'mobile'),
					)),
				);
			} catch {
				// 读取/删除失败则跳过（文件可能正在同步）/ Skip on failure (file may be syncing)
			}
		}
	}

	/**
	 * 追加新条目 / Append new entry
	 */
	async appendEntry(entry: QueueEntry): Promise<void> {
		await this.ensureDir();
		const fileName = this.buildFileName(entry);
		// 与 ensureDir 读取同一时刻的目录：顶部缓存一次，避免拼路径时读到变更后的设置
		// Read the folder at the same instant as ensureDir: cache once so path building
		// doesn't see a settings change that happened between ensureDir and here
		const outputFolder = this.getOutputFolder();
		const filePath = `${outputFolder}/${fileName}`;
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
