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
	private readonly outputFolder: string;

	constructor(
		private vault: Vault,
		outputFolder: string,
		/**
		 * 可选：用于内存查 frontmatter.sts_id，跳过已处理的 .md 文件，避免文件 I/O
		 * Optional: used to check frontmatter.sts_id in memory, skipping processed .md files
		 */
		private metadataCache?: MetadataCache,
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
	 *
	 * 内部先调用 convertShareMenuNotes() 将分享菜单创建的 .md 转为队列条目
	 * Internally calls convertShareMenuNotes() first to convert share-menu .md to queue entries
	 */
	async getPendingEntries(): Promise<QueueEntryWithPath[]> {
		await this.ensureDir();

		// 先将分享菜单 .md 文件转换为标准队列条目 / Convert share-menu .md files first
		await this.convertShareMenuNotes();

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
	 * 将新分享菜单创建的 .md 文件转换为标准队列条目
	 * Convert share-menu-created .md files to standard queue entries
	 *
	 * 通过 frontmatter 中是否包含 sts_id 区分已处理文件和外来文件：
	 *   - metadataCache 命中且 frontmatter 有 sts_id → 跳过（0 I/O）
	 *   - metadataCache 未命中 → 读文件，正则检查 sts_id
	 *   - 无 sts_id → extractUrls() 提取 URL → 删 .md → 建 toBeSaved_*.json
	 *
	 * Distinguished by presence of sts_id in frontmatter:
	 *   - metadataCache hit with sts_id → skip (0 I/O)
	 *   - metadataCache miss → read file, regex check sts_id
	 *   - No sts_id → extractUrls() → delete .md → create toBeSaved_*.json
	 *
	 * ★ 先删 .md 再建队列条目，防止中间崩溃导致下次重复处理
	 * ★ Delete .md before creating queue entries to prevent duplicate on crash
	 */
	private async convertShareMenuNotes(): Promise<void> {
		const files = await this.vault.adapter.list(this.outputFolder);

		for (const filePath of files.files) {
			if (!filePath.endsWith('.md')) continue;

			try {
				// ── 判断是否已处理 / Check if already processed ──
				let hasStsId = false;

				// 优先从 metadataCache 内存查（0 I/O）/ Try cache first (0 I/O)
				if (this.metadataCache) {
					const cache = this.metadataCache.getCache(filePath);
					if (cache?.frontmatter) {
						hasStsId = 'sts_id' in cache.frontmatter;
					}
				}

				// 缓存未命中则读文件确认 / Read file as fallback if cache miss
				if (!hasStsId) {
					const raw = await this.vault.adapter.read(filePath);
					if (!raw.trim()) continue;

					// 精确检测 frontmatter 块中是否含 sts_id
					// Precisely check for sts_id within frontmatter block
					hasStsId = /^---[\s\S]*?\bsts_id\s*:[\s\S]*?^---/m.test(raw);

					// 已处理 → 跳过 / Already processed → skip
					if (hasStsId) continue;

					// ── 提取 URL 并转换 / Extract URLs and convert ──
					const urls = extractUrls(raw);
					if (urls.length === 0) continue;

					// ★ 先删除原始文件（防崩溃重复）
					// ★ Delete original first (prevent re-detection on crash)
					await this.vault.adapter.remove(filePath);

					// 再创建队列条目 / Then create queue entries
					for (const url of urls) {
						await this.appendEntry({
							id: crypto.randomUUID(),
							url,
							source: 'mobile',
							createdAt: new Date().toISOString(),
						});
					}
				}
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
