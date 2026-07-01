/**
 * 图片处理器：下载外链图片到本地 attachments 文件夹，替换为 wikilink
 * Image handler: download external images to local attachments folder, replace with wikilinks
 *
 * 参考 ima-copilot-sync 的 ImageHandler 和 path-utils 实现
 * Based on ima-copilot-sync's ImageHandler and path-utils implementation
 */

import { Vault, normalizePath } from 'obsidian';
import { buildHeaders } from './http-utils';
import { sanitizeFilename as sanitizeForFs } from './text-utils';

/** 匹配 Markdown 图片语法 / Match Markdown image syntax */
const IMG_URL_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** 匹配 wikilink 格式 / Match wikilink format */
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/;

// ─── 文件名工具 / Filename utilities ──────────────────────────────────────────

/** 清理标题为安全文件名片段 / Sanitize title for filename segment */
function sanitizeTitle(name: string | undefined, fallback = 'image'): string {
	return name
		? name.replace(/\s+/g, '-').replace(/[\\/:*?"<>|]/g, '_')
		: fallback;
}

/** 生成 URL 短哈希（8 位十六进制）/ Generate short URL hash (8 hex chars) */
function shortHash(url: string): string {
	let hash = 0;
	for (let i = 0; i < url.length; i++) {
		hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 从 URL 路径提取扩展名 / Extract extension from URL path */
function extractExtFromUrl(url: string): string {
	try {
		const urlObj = new URL(url);
		const lastSegment = urlObj.pathname.split('/').pop() ?? '';
		const dotIdx = lastSegment.lastIndexOf('.');
		if (dotIdx > 0) return lastSegment.slice(dotIdx).toLowerCase();
	} catch { /* ignore */ }
	return '';
}

/**
 * 根据 URL 猜测文件扩展名 / Guess file extension from URL
 * 仅检查 path + query + fragment，避免域名中 .png 等被误匹配
 * Only checks path + query + fragment, avoiding false matches in hostname
 */
function guessFileExtension(url: string): string {
	// 微信 CDN 图片：从 wx_fmt 参数推断格式（比 pathname 和 Content-Type 更可靠）
	// WeChat CDN images: infer format from wx_fmt param (more reliable than pathname or Content-Type)
	try {
		const wxFmt = new URL(url).searchParams.get('wx_fmt');
		if (wxFmt) {
			const fmt = wxFmt.toLowerCase();
			if (fmt === 'jpeg' || fmt === 'jpg') return '.jpg';
			if (fmt === 'png') return '.png';
			if (fmt === 'gif') return '.gif';
			if (fmt === 'webp') return '.webp';
			if (fmt === 'svg') return '.svg';
		}
	} catch { /* ignore parse errors */ }

	let target = url;
	try {
		const u = new URL(url);
		target = u.pathname + u.search + u.hash;
	} catch { /* use as-is */ }

	const lower = target.toLowerCase();
	if (lower.includes('.png')) return '.png';
	if (lower.includes('.jpg') || lower.includes('.jpeg')) return '.jpg';
	if (lower.includes('.gif')) return '.gif';
	if (lower.includes('.webp')) return '.webp';
	if (lower.includes('.svg')) return '.svg';
	return '';
}

/**
 * 根据 HTTP Content-Type 推导文件扩展名
 * Derive file extension from HTTP Content-Type header
 *
 * 当 URL 扩展名与实际内容类型不一致时（如知乎 CDN .avis 实际是 PNG），
 * 用 Content-Type 修正扩展名，优先级高于 URL 扩展名。
 * When URL extension doesn't match actual content type (e.g. Zhihu CDN .avis is actually PNG),
 * correct the extension using Content-Type, which takes priority over URL extension.
 */
function contentTypeToExt(contentType: string): string {
	const ct = (contentType.split(';')[0] ?? '').trim().toLowerCase();
	if (ct === 'image/png') return '.png';
	if (ct === 'image/jpeg' || ct === 'image/jpg') return '.jpg';
	if (ct === 'image/gif') return '.gif';
	if (ct === 'image/webp') return '.webp';
	if (ct === 'image/svg+xml') return '.svg';
	if (ct === 'image/avif') return '.avif';
	return '';
}

/**
 * 从 URL 构建稳定的本地文件名
 * Build stable local filename from URL
 *
 * 格式 / Format: {noteTitle}-{urlSegment}{ext}
 * 末尾段为纯数字时（如 mmbiz /0）使用 URL 短 hash
 * When last segment is numeric (e.g. mmbiz /0), use short URL hash
 */
function buildStableFilename(
	url: string,
	options: { titleBase?: string; fallbackName: string; fallbackExt?: string; contentType?: string },
): string {
	let filename = '';
	let ext = '';
	try {
		const urlObj = new URL(url);
		const segments = urlObj.pathname.split('/').filter(s => s.length > 0);
		const lastSegment = segments[segments.length - 1];
		if (lastSegment && /^\d+$/.test(lastSegment)) {
			filename = shortHash(url);
		} else if (lastSegment) {
			filename = decodeURIComponent(lastSegment);
			const dotIdx = filename.lastIndexOf('.');
			if (dotIdx > 0) {
				ext = filename.slice(dotIdx).toLowerCase();
			}
		}
	} catch { /* ignore */ }

	if (!ext) {
		ext = extractExtFromUrl(url) || guessFileExtension(url) || options.fallbackExt || '';
	}

	// Content-Type 修正：当 HTTP 响应的实际内容类型与 URL 扩展名不一致时，覆盖扩展名
	// Content-Type correction: override extension when actual content type differs from URL extension
	if (options.contentType) {
		const ctExt = contentTypeToExt(options.contentType);
		if (ctExt && ext && ext !== ctExt) {
			// 剥离 filename 中旧扩展名，否则 filename.includes('.') 为 true 会跳过新扩展名拼接
			// Strip old extension from filename, otherwise filename.includes('.') stays true
			const dotIdx = filename.lastIndexOf('.');
			if (dotIdx > 0) {
				filename = filename.slice(0, dotIdx);
			}
			ext = ctExt;
		}
	}

	const safeTitle = sanitizeTitle(options.titleBase, options.fallbackName);
	const baseFilename = filename
		? (filename.includes('.') ? filename : `${filename}${ext}`)
		: `${options.fallbackName}${ext}`;
	return sanitizeForFs(`${safeTitle}-${sanitizeForFs(baseFilename)}`);
}

// ─── 图片处理器 / Image handler ──────────────────────────────────────────────


export class ImageHandler {
	constructor(
		private vault: Vault,
		/**
		 * 输出目录 getter：实时读取当前设置值，避免设置变更后附件仍写入旧目录
		 * Output folder getter: reads the current setting live, so changing it
		 * mid-session doesn't leave attachments writing to the stale folder
		 */
		private readonly getOutputFolder: () => string,
	) {}

	/**
	 * 计算附件目录路径（基于当前 outputFolder 实时读取）
	 * Compute the attachments directory path (reads current outputFolder live)
	 */
	private getAttachmentsDir(): string {
		return normalizePath(`${this.getOutputFolder()}/attachments`);
	}

	/**
	 * 预处理：剥离 linked image 的外层 Markdown 链接。
	 * defuddle 将 <a><img></a> 转为 [![alt](img-url)](link-url) 是完全合法的 Markdown，
	 * 但图片下载后 wikilink 不支持嵌套在 markdown 链接中（[![[wikilink]](url) 无效），
	 * 因此先扁平化为 ![alt](img-url)，后续管线统一处理。
	 *
	 * Pre-process: strip outer markdown link wrapper from linked images.
	 * defuddle converts <a><img></a> → [![alt](img-url)](link-url) (valid Markdown),
	 * but wikilinks can't be nested in markdown links after localization
	 * ([![[wikilink]](url) is invalid). Flatten them first so downstream handles uniformly.
	 *
	 * 参考 obsidian-auto-download-images-after-web-clipping 的 linked-image-first 策略
	 * Based on obsidian-auto-download-images-after-web-clipping's linked-image-first strategy
	 */
	private static stripLinkedImageOuterLink(markdown: string): string {
		// 链接图片：[...] 内恰好一个完整图片时，剥离外层链接
		// Linked image: when [...] body is exactly one image, strip outer link
		markdown = markdown.replace(
			/\[(!\[[^\]]*\]\(https?:\/\/[^)\s]+\))\]\(https?:\/\/[^)\s]+\)/g,
			'$1',
		);

		return markdown;
	}

	/**
	 * 处理 markdown 内容中的外链图片：
	 * 1. 正则匹配 ![](url)
	 * 2. 跳过已为 wikilink 格式的链接
	 * 3. 下载到 {outputFolder}/attachments/
	 * 4. 替换为 ![[attachments/filename]] wikilink
	 *
	 * Process external images in markdown:
	 * 1. Regex match ![](url)
	 * 2. Skip already-wikilink links
	 * 3. Download to {outputFolder}/attachments/
	 * 4. Replace with ![[attachments/filename]] wikilinks
	 */
	async processContent(
		markdown: string,
		noteTitle: string,
		sourceUrl?: string,
	): Promise<string> {
		// 确保附件目录存在 / Ensure attachments directory exists
		await this.ensureAttachmentsDir();

		// 预处理：linked image 本地化后 wikilink 不支持嵌套在 markdown 链接中，
		// 将 [![alt](img-url)](link-url) → ![alt](img-url)（丢弃外层链接 URL）
		// Pre-processing: wikilink can't be nested in markdown links after localization,
		// flatten [![alt](img-url)](link-url) → ![alt](img-url) (discard outer link URL)
		markdown = ImageHandler.stripLinkedImageOuterLink(markdown);

		// 批量去重映射：content hash → wikilink
		// Batch dedup map: content hash → wikilink
		const dedupMap = new Map<string, string>();

		// 下载外链图片并替换为 wikilink / Download external images and replace with wikilinks
		markdown = await this.processMatches(markdown, IMG_URL_REGEX, noteTitle, dedupMap, sourceUrl);

		return markdown;
	}

	/**
	 * 并发控制工具：最多 limit 个并发执行异步任务，单个失败不影响其他
	 * Concurrency limiter: execute async tasks with max `limit` concurrency; single failure doesn't abort others
	 */
	private async withConcurrencyLimit<T, R>(
		items: T[],
		limit: number,
		fn: (item: T) => Promise<R>,
	): Promise<(R | null)[]> {
		const results = new Array<R | null>(items.length);
		let index = 0;

		const worker = async (): Promise<void> => {
			while (index < items.length) {
				const i = index++;
				try {
					results[i] = await fn(items[i]!);
				} catch {
					results[i] = null;
				}
			}
		};

		const workerCount = Math.min(limit, items.length);
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		return results;
	}

	/**
	 * 处理正则匹配到的所有链接 / Process all links matched by regex
	 */
	private async processMatches(
		markdown: string,
		regex: RegExp,
		noteTitle: string,
		dedupMap: Map<string, string>,
		sourceUrl?: string,
	): Promise<string> {
		const matches: Array<{ full: string; alt: string; url: string }> = [];
		const re = new RegExp(regex.source, 'g');
		let match: RegExpExecArray | null;

		while ((match = re.exec(markdown)) !== null) {
			const full = match[0];
			const alt = match[1] ?? '';
			const url = match[2] ?? '';
			// 跳过已为 wikilink 的 / Skip already-wikilink
			if (WIKILINK_REGEX.test(url)) continue;
			matches.push({ full, alt, url });
		}

		// Phase 1: 并发下载（最多 3 并发，15s 超时 + 1 次重试）
		// Phase 1: concurrent download (max 3 concurrent, 15s timeout + 1 retry)
		type DownloadResult = { full: string; url: string; buffer: Buffer; contentType: string } | { full: string; url: string; buffer: null };
		// 回调内所有路径都 catch，不会抛异常，null 情况不会发生 / Callback catches all errors, null case impossible
		const downloadResults = await this.withConcurrencyLimit(matches, 3, async (m) => {
			try {
				const { buffer, contentType } = await this.downloadWithRetry(m.url, sourceUrl);
				return { full: m.full, url: m.url, buffer, contentType };
			} catch (err) {
				console.warn(`Share to Save: 附件下载失败 / Attachment download failed: ${m.url}`, err);
				return { full: m.full, url: m.url, buffer: null };
			}
		}) as DownloadResult[];

		// Phase 2: 顺序应用（去重 + 保存 + 替换，必须顺序执行保证 dedup 和 markdown 替换正确）
		// Phase 2: sequential apply (dedup + save + replace, must be sequential for correct dedup and string replacement)
		// 整批图片复用同一附件目录：循环外缓存一次，避免中途设置变更导致同篇笔记图片散落到不同目录
		// Reuse one attachments dir for the whole batch: cache once outside the loop so a
		// mid-batch settings change doesn't scatter one note's images across different folders
		const attachmentsDir = this.getAttachmentsDir();
		for (const result of downloadResults) {
			if (!result.buffer) continue;
			const { full, url, buffer, contentType } = result;

			const filename = buildStableFilename(url, {
				titleBase: noteTitle,
				fallbackName: 'image',
				fallbackExt: '.png',
				contentType,
			});

			const localPath = `${attachmentsDir}/${filename}`;

			// 内容哈希去重：同一次批处理中相同内容复用第一个 wikilink
			// Content hash dedup: same content within a batch reuses first wikilink
			const contentHash = this.computeContentHash(buffer);
			const existingWikilink = dedupMap.get(contentHash);
			if (existingWikilink) {
				markdown = markdown.replace(full, existingWikilink);
				continue;
			}
			const wikilink = this.buildWikilink(filename, full.startsWith('!['));
			dedupMap.set(contentHash, wikilink);

			// 去重：已存在且内容相同则跳过 / Dedup: skip if exists with same content
			if (await this.existsWithSameContent(localPath, buffer)) {
				markdown = markdown.replace(full, wikilink);
				continue;
			}

			// 保存二进制文件 / Save binary file
			const normalized = normalizePath(localPath);
			const dir = normalized.substring(0, normalized.lastIndexOf('/'));
			const dirExists = await this.vault.adapter.exists(dir);
			if (!dirExists) {
				await this.vault.createFolder(dir);
			}
			await this.vault.createBinary(normalized, buffer);

			// 替换原 URL 为 wikilink / Replace original URL with wikilink
			markdown = markdown.replace(full, wikilink);
		}

		return markdown;
	}

	/**
	 * 构建 wikilink 字符串 / Build wikilink string
	 */
	private buildWikilink(filename: string, isImage: boolean): string {
		const link = `attachments/${filename}`;
		return isImage ? `![[${link}]]` : `[[${link}]]`;
	}

	/**
	 * 确保附件目录存在 / Ensure attachments directory exists
	 */
	private async ensureAttachmentsDir(): Promise<void> {
		// 顶部缓存一次，避免 exists 与 createFolder 两次 getter 读取间设置变更导致错位
		// Cache once up front so exists/createFolder see the same folder even if settings change mid-call
		const dir = this.getAttachmentsDir();
		const exists = await this.vault.adapter.exists(dir);
		if (!exists) {
			await this.vault.createFolder(dir);
		}
	}

	/**
	 * 通过 Node.js https.get 获取二进制数据
	 * Fetch binary data via Node.js https.get
	 */
	private nodeHttpsGetBuffer(url: string, sourceUrl?: string): Promise<{ buffer: Buffer; contentType: string }> {
		// 根据协议动态选择模块，支持 HTTP 和 HTTPS / Select module by protocol, support both HTTP and HTTPS
		const protocol = new URL(url).protocol === 'http:' ? 'http' : 'https';
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require for Node.js protocol module based on URL scheme
		const mod = require(protocol) as typeof import('https');

		return new Promise<{ buffer: Buffer; contentType: string }>((resolve, reject) => {
			const doRequest = (requestUrl: string): void => {
				const headers = buildHeaders(sourceUrl, 'image/*, */*');
				const req = mod.get(requestUrl, { headers }, (res) => {
					// 处理重定向 / Handle redirect
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						doRequest(res.headers.location);
						return;
					}
					if (!res.statusCode || res.statusCode >= 400) {
						reject(new Error(`HTTP ${res.statusCode}`));
						return;
					}
					// 提取 Content-Type 用于后续扩展名修正 / Capture Content-Type for later extension correction
					const contentType = res.headers['content-type'] ?? '';
					const chunks: Buffer[] = [];
					res.on('data', (chunk: Buffer) => chunks.push(chunk));
					res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
					res.on('error', reject);
				});
				req.on('error', reject);
				req.setTimeout(15_000, () => {
					req.destroy();
					reject(new Error('下载超时 / Download timeout'));
				});
			};
			doRequest(url);
		});
	}

	/**
	 * 带重试的图片下载：15s 超时 + 1 次重试 + 1s 退避
	 * Image download with retry: 15s timeout + 1 retry + 1s backoff
	 */
	private async downloadWithRetry(url: string, sourceUrl?: string): Promise<{ buffer: Buffer; contentType: string }> {
		for (let attempt = 0; attempt <= 1; attempt++) {
			try {
				return await this.nodeHttpsGetBuffer(url, sourceUrl);
			} catch (err) {
				if (attempt === 1) throw err;
				await new Promise(r => window.setTimeout(r, 1_000));
			}
		}
		throw new Error('unreachable');
	}

	/**
	 * 计算二进制内容的快速哈希（用于批处理内去重）
	 * Compute fast hash of binary content (for batch dedup)
	 *
	 * 使用 buffer 长度 + 首尾各 64 字节构成指纹，足以在实践范围内唯一标识图片
	 * Uses buffer length + first/last 64 bytes as fingerprint, sufficient for image dedup in practice
	 */
	private computeContentHash(buffer: Buffer): string {
		const len = buffer.length;
		const head = buffer.subarray(0, 64).toString('hex');
		const tail = buffer.subarray(-64).toString('hex');
		return `${len}:${head}:${tail}`;
	}

	/**
	 * 去重检查：文件已存在且内容相同则跳过
	 * Dedup check: skip if file exists with same content
	 */
	private async existsWithSameContent(path: string, buffer: Buffer): Promise<boolean> {
		try {
			const exists = await this.vault.adapter.exists(path);
			if (!exists) return false;

			const existingArrayBuffer = await this.vault.adapter.readBinary(path);
			const existing = new Uint8Array(existingArrayBuffer);
			if (existing.length !== buffer.length) return false;

			// 逐字节比较 / Byte-by-byte comparison
			for (let i = 0; i < existing.length; i++) {
				if (existing[i] !== buffer[i]) return false;
			}
			return true;
		} catch {
			return false;
		}
	}
}
