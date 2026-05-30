/**
 * 图片/附件处理器：下载外链图片到本地 attachments 文件夹，替换为 wikilink
 * Image/Attachment handler: download external images to local attachments folder, replace with wikilinks
 *
 * 参考 ima-copilot-sync 的 ImageHandler 和 path-utils 实现
 * Based on ima-copilot-sync's ImageHandler and path-utils implementation
 */

import { Vault, normalizePath } from 'obsidian';
import { CHROME_UA } from './types';

/** 匹配 Markdown 图片语法 / Match Markdown image syntax */
const IMG_URL_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** 匹配 Markdown 文件链接语法 / Match Markdown file link syntax */
const FILE_URL_REGEX = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** 匹配 wikilink 格式 / Match wikilink format */
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/;

// ─── 文件名工具 / Filename utilities ──────────────────────────────────────────

/** 清理文件名中的非法字符 / Sanitize illegal characters in filename */
function sanitizeFilename(name: string): string {
	return name
		.replace(/[/\\:*?"<>|#^[\]]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

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
	if (lower.includes('.pdf')) return '.pdf';
	if (lower.includes('.doc') || lower.includes('.docx')) return '.docx';
	if (lower.includes('.ppt') || lower.includes('.pptx')) return '.pptx';
	if (lower.includes('.xls') || lower.includes('.xlsx')) return '.xlsx';
	if (lower.includes('.txt')) return '.txt';
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
	options: { titleBase?: string; fallbackName: string; fallbackExt?: string },
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

	const safeTitle = sanitizeTitle(options.titleBase, options.fallbackName);
	const baseFilename = filename
		? (filename.includes('.') ? filename : `${filename}${ext}`)
		: `${options.fallbackName}${ext}`;
	return sanitizeFilename(`${safeTitle}-${sanitizeFilename(baseFilename)}`);
}

// ─── 图片处理器 / Image handler ──────────────────────────────────────────────


export class ImageHandler {
	private readonly attachmentsDir: string;

	constructor(
		private vault: Vault,
		outputFolder: string,
	) {
		this.attachmentsDir = normalizePath(`${outputFolder}/attachments`);
	}

	/**
	 * 处理 markdown 内容中的外链图片和文件：
	 * 1. 正则匹配 ![](url) 和 [text](url)
	 * 2. 跳过已为 wikilink 格式的链接
	 * 3. 下载到 {outputFolder}/attachments/
	 * 4. 替换为 [[attachments/filename]] wikilink
	 *
	 * Process external images/files in markdown:
	 * 1. Regex match ![](url) and [text](url)
	 * 2. Skip already-wikilink links
	 * 3. Download to {outputFolder}/attachments/
	 * 4. Replace with [[attachments/filename]] wikilinks
	 */
	async processContent(
		markdown: string,
		noteTitle: string,
	): Promise<string> {
		// 确保附件目录存在 / Ensure attachments directory exists
		await this.ensureAttachmentsDir();

		// 批量去重映射：content hash → wikilink
		// Batch dedup map: content hash → wikilink
		const dedupMap = new Map<string, string>();

		// 第一遍：处理图片 / First pass: images
		markdown = await this.processMatches(markdown, IMG_URL_REGEX, noteTitle, dedupMap);

		// 第二遍：处理文件链接 / Second pass: file links
		markdown = await this.processMatches(markdown, FILE_URL_REGEX, noteTitle, dedupMap);

		return markdown;
	}

	/**
	 * 处理正则匹配到的所有链接 / Process all links matched by regex
	 */
	private async processMatches(
		markdown: string,
		regex: RegExp,
		noteTitle: string,
		dedupMap: Map<string, string>,
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

		// 逐图下载并替换 / Download and replace one by one
		for (const { full, url } of matches) {
			// 非图片链接仅处理可识别文件扩展名的 URL，网页链接保持原样
			// Non-image links: only process URLs with recognizable file extensions; web links stay as-is
			const isImageRegex = regex.source === IMG_URL_REGEX.source;
			if (!isImageRegex && !guessFileExtension(url)) continue;
			try {
				const filename = buildStableFilename(url, {
					titleBase: noteTitle,
					fallbackName: 'image',
					fallbackExt: '.png',
				});

				const localPath = `${this.attachmentsDir}/${filename}`;

			// 下载图片 / Download image
			const buffer = await this.nodeHttpsGetBuffer(url);

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
			} catch (err) {
				// 单张图片下载失败不影响整体 / Single image failure doesn't abort the whole process
				// eslint-disable-next-line no-console
				console.warn(`Share to Save: 附件下载失败 / Attachment download failed: ${url}`, err);
			}
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
		const exists = await this.vault.adapter.exists(this.attachmentsDir);
		if (!exists) {
			await this.vault.createFolder(this.attachmentsDir);
		}
	}

	/**
	 * 通过 Node.js https.get 获取二进制数据
	 * Fetch binary data via Node.js https.get
	 */
	private nodeHttpsGetBuffer(url: string): Promise<Buffer> {
		// 根据协议动态选择模块，支持 HTTP 和 HTTPS / Select module by protocol, support both HTTP and HTTPS
		const protocol = new URL(url).protocol === 'http:' ? 'http' : 'https';
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require(protocol) as typeof import('https');

		return new Promise<Buffer>((resolve, reject) => {
			const doRequest = (requestUrl: string): void => {
				// 微信 CDN 图片需要 Referer 绕过防盗链 / WeChat CDN images need Referer to bypass hotlink protection
				const isWeChatCdn = /qpic\.cn/.test(requestUrl);
				const imgHeaders: Record<string, string> = {
					'User-Agent': CHROME_UA,
					'Accept': 'image/*, */*',
				};
				if (isWeChatCdn) {
					imgHeaders['Referer'] = 'https://mp.weixin.qq.com/';
				}
				const req = mod.get(requestUrl, {
					headers: imgHeaders,
				}, (res) => {
					// 处理重定向 / Handle redirect
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						doRequest(res.headers.location);
						return;
					}
					if (!res.statusCode || res.statusCode >= 400) {
						reject(new Error(`HTTP ${res.statusCode}`));
						return;
					}
					const chunks: Buffer[] = [];
					res.on('data', (chunk: Buffer) => chunks.push(chunk));
					res.on('end', () => resolve(Buffer.concat(chunks)));
					res.on('error', reject);
				});
				req.on('error', reject);
				req.setTimeout(60_000, () => {
					req.destroy();
					reject(new Error('下载超时 / Download timeout'));
				});
			};
			doRequest(url);
		});
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
