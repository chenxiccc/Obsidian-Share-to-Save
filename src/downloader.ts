/**
 * URL 内容下载器：HTML 获取 → defuddle 解析 → 图片处理 → .md 保存
 * URL content downloader: fetch HTML → defuddle parse → image processing → save .md
 *
 * 仅在桌面端运行（依赖 Node.js https）/ Desktop only (depends on Node.js https)
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings } from './types';
import { ImageHandler } from './image-handler';
import { Defuddle } from 'defuddle/node';

/** Chrome UA for Node.js https */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.108 Safari/537.36';

export class Downloader {
	private readonly imageHandler: ImageHandler;

	constructor(
		private vault: Vault,
		private settings: ShareToSaveSettings,
	) {
		this.imageHandler = new ImageHandler(vault, settings.outputFolder);
	}

	/**
	 * 处理单个 URL：下载 HTML → defuddle 解析 → 下载图片 → 保存 .md
	 * Process a single URL: download HTML → defuddle parse → download images → save .md
	 *
	 * @param url 目标 URL / Target URL
	 * @param stsId 队列条目 UUID，写入 frontmatter / Queue entry UUID, written to frontmatter
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		// 1. 下载 HTML / Download HTML
		const html = await this.fetchHtml(url);

		// 2. defuddle 解析 / Parse with defuddle
		const parsed = await this.parseWithDefuddle(html, url);

		// 3. 生成安全文件名 / Generate safe filename
		const safeTitle = this.sanitizeNoteTitle(parsed.title || 'Untitled');
		const notePath = normalizePath(`${this.settings.outputFolder}/${safeTitle}.md`);

		// 4. 构建 frontmatter + Markdown body / Build frontmatter + Markdown body
		const frontmatter = this.buildFrontmatter(parsed, url, stsId);
		let mdContent = frontmatter + '\n' + parsed.content;

		// 5. 处理图片/附件 / Process images/attachments
		mdContent = await this.imageHandler.processContent(mdContent, safeTitle);

		// 6. 确保输出目录存在 / Ensure output directory exists
		const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
		if (!dirExists) {
			await this.vault.createFolder(this.settings.outputFolder);
		}

		// 7. 写入 .md 文件 / Write .md file
		await this.vault.create(notePath, mdContent);

		return { success: true, title: safeTitle };
	}

	/**
	 * 通过 Node.js https.get 获取网页 HTML
	 * Fetch webpage HTML via Node.js https.get
	 */
	private async fetchHtml(url: string): Promise<string> {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const https: typeof import('https') = require('https');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const zlib: typeof import('zlib') = require('zlib');

		const html = await new Promise<string>((resolve, reject) => {
			const doRequest = (requestUrl: string, redirectCount = 0): void => {
				if (redirectCount > 10) {
					reject(new Error('重定向次数过多 / Too many redirects'));
					return;
				}

				const req = https.get(requestUrl, {
					headers: {
						'User-Agent': CHROME_UA,
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
					},
				}, (res) => {
					// 处理重定向 / Handle redirect
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						doRequest(res.headers.location, redirectCount + 1);
						return;
					}
					if (!res.statusCode || res.statusCode >= 400) {
						reject(new Error(`HTTP ${res.statusCode} for ${url}`));
						return;
					}

					const chunks: Buffer[] = [];
					const encoding = res.headers['content-encoding'];

					let stream: import('stream').Readable = res;
					// 处理 gzip/deflate 压缩 / Handle gzip/deflate compression
					if (encoding === 'gzip') {
						stream = res.pipe(zlib.createGunzip());
					} else if (encoding === 'deflate') {
						stream = res.pipe(zlib.createInflate());
					}

					stream.on('data', (chunk: Buffer) => chunks.push(chunk));
					stream.on('end', () => {
						const buffer = Buffer.concat(chunks);
						// 尝试用 UTF-8 解码 / Try UTF-8 decode
						let text = buffer.toString('utf-8');
						// 从 meta charset 中检测编码 / Detect encoding from meta charset
						const charsetMatch = text.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s>]+)/i);
						if (charsetMatch && charsetMatch[1]) {
							const detectedCharset = charsetMatch[1].toLowerCase();
							if (detectedCharset !== 'utf-8' && detectedCharset !== 'utf8') {
								try {
									text = buffer.toString(detectedCharset as BufferEncoding);
								} catch {
									// 回退到 utf-8 / Fallback to utf-8
								}
							}
						}
						resolve(text);
					});
					stream.on('error', reject);
				});
				req.on('error', reject);
				req.setTimeout(30_000, () => {
					req.destroy();
					reject(new Error('下载超时 / Download timeout'));
				});
			};
			doRequest(url);
		});

		return html;
	}

	/**
	 * 调用 defuddle/node 解析 HTML → Markdown
	 * Parse HTML → Markdown via defuddle/node
	 */
	private async parseWithDefuddle(html: string, url: string): Promise<ParsedContent> {
		const result = await Defuddle(html, url, { markdown: false });
		// defuddle/node 内部已调用 toMarkdown，将结果写入 contentMarkdown
		// defuddle/node internally calls toMarkdown, writing result to contentMarkdown
		const markdown = result.contentMarkdown
			?? result.content
			?? '';

		// 提取图片 URL 列表 / Extract image URL list
		const imageUrls = this.extractImageUrls(markdown);

		return {
			title: result.title || 'Untitled',
			author: result.author || '',
			authorUrl: result.authorUrl,
			published: result.published || '',
			content: markdown,
			imageUrls,
		};
	}

	/**
	 * 从 Markdown 中提取所有外链图片 URL
	 * Extract all external image URLs from Markdown
	 */
	private extractImageUrls(markdown: string): string[] {
		const regex = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
		const urls: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = regex.exec(markdown)) !== null) {
			if (match[1]) {
				urls.push(match[1]);
			}
		}
		return urls;
	}

	/**
	 * 构建 YAML frontmatter
	 * Build YAML frontmatter
	 */
	private buildFrontmatter(
		parsed: ParsedContent,
		sourceUrl: string,
		stsId: string,
	): string {
		const lines: string[] = ['---'];
		lines.push(`source: "${sourceUrl}"`);
		lines.push(`sts_id: "${stsId}"`);

		if (parsed.author) {
			lines.push('author:');
			if (parsed.authorUrl) {
				lines.push(`  - "[${parsed.author}](${parsed.authorUrl})"`);
			} else {
				lines.push(`  - "${parsed.author}"`);
			}
		}

		if (parsed.published) {
			const formatted = this.formatDateTime(parsed.published);
			if (formatted) {
				lines.push(`published: ${formatted}`);
			}
		}

		lines.push(`created: ${new Date().toISOString().slice(0, 19)}`);
		lines.push('---');
		return lines.join('\n');
	}

	/**
	 * 将各种日期格式统一为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss
	 * Normalize various date formats to YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
	 */
	private formatDateTime(input: string): string | null {
		if (!input) return null;
		try {
			const date = new Date(input);
			if (isNaN(date.getTime())) return null;
			// 如果时间部分是 00:00:00，则只返回日期 / If time part is midnight, return date only
			if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) {
				return date.toISOString().slice(0, 10);
			}
			return date.toISOString().slice(0, 19);
		} catch {
			return null;
		}
	}

	/**
	 * 清理笔记标题为安全文件名 / Sanitize note title for safe filename
	 */
	private sanitizeNoteTitle(title: string): string {
		return title
			.replace(/[/\\:*?"<>|#^[\]]/g, '_')
			.replace(/\s+/g, ' ')
			.trim()
			// 限制长度 / Limit length
			.slice(0, 200);
	}
}
