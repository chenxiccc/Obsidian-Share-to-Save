/**
 * URL 内容下载器：HTML 获取 → defuddle 解析 → 图片处理 → .md 保存
 * URL content downloader: fetch HTML → defuddle parse → image processing → save .md
 *
 * 仅在桌面端运行（依赖 Node.js https/http）/ Desktop only (depends on Node.js https/http)
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings } from './types';
import { ImageHandler } from './image-handler';
import { Defuddle } from 'defuddle/node';
import { HeadlessExtractor } from './headless-extractor';

/** Chrome UA for Node.js https — 与 ima-copilot-sync 完全一致 / Chrome UA — identical to ima-copilot-sync */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.108 Safari/537.36';

/** 提取内容过短阈值 / Content too short threshold */
const MIN_CONTENT_LENGTH = 120;
/** JS 渲染空壳判定：HTML 超过此字节 / JS shell detection: HTML larger than this (bytes) */
const LOOKS_LIKE_JS_HTML_SIZE = 500_000;
/** JS 渲染空壳判定：提取内容短于此字符数 / JS shell detection: content shorter than this (chars) */
const LOOKS_LIKE_JS_MAX_CONTENT = 2000;

export class Downloader {
	private readonly imageHandler: ImageHandler;
	private readonly headlessExtractor: HeadlessExtractor;

	constructor(
		private vault: Vault,
		private settings: ShareToSaveSettings,
	) {
		this.imageHandler = new ImageHandler(vault, settings.outputFolder);
		this.headlessExtractor = new HeadlessExtractor();
	}

	/**
	 * 处理单个 URL：下载 HTML → defuddle 解析 → 下载图片 → 保存 .md
	 * Process a single URL: download HTML → defuddle parse → download images → save .md
	 *
	 * 回退策略（参考 ima-copilot-sync）/ Fallback strategy (based on ima-copilot-sync):
	 *   Tier 1: Node.js https/http.get 获取静态 HTML → defuddle 解析
	 *   Tier 2: headless Electron BrowserWindow 重新抓取 JS 渲染后的 HTML → defuddle 再解析
	 *
	 * Headless 触发条件 / Headless trigger conditions:
	 *   - contentTooShort: 提取内容 < 120 字符
	 *   - hasOrphanImages: 原始 HTML 有 <img> 但 Markdown 没图
	 *   - looksLikeJsPage: HTML > 500KB 但提取内容 < 2000 字符
	 *
	 * @param url 目标 URL / Target URL
	 * @param stsId 队列条目 UUID，写入 frontmatter / Queue entry UUID, written to frontmatter
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		// 1. Tier 1: 下载静态 HTML / Tier 1: download static HTML
		const html = await this.fetchHtml(url);

		// 2. defuddle 解析 / Parse with defuddle
		let parsed = await this.parseWithDefuddle(html, url);

		// 3. Tier 2: headless 判定 / Tier 2: headless decision
		const contentLen = (parsed.content || '').length;
		const contentTooShort = contentLen < MIN_CONTENT_LENGTH;

		// HTML 含 <img> 但 Markdown 没图 → 图片由 JS 加载，需 headless
		// HTML has <img> but Markdown has no images → images loaded by JS, need headless
		const htmlHasImgs = /<img[^>]+src=["']https?:\/\//i.test(html);
		const mdHasImages = /!\[.*\]\(https?:\/\//.test(parsed.content || '');
		const hasOrphanImages = htmlHasImgs && !mdHasImages;

		// HTML 很大（>500KB JS）但提取内容很短（<2000 chars）→ JS 渲染空壳
		// Large HTML (>500KB JS) but short content (<2000 chars) → JS-rendered shell
		const looksLikeJsPage = html.length > LOOKS_LIKE_JS_HTML_SIZE && contentLen < LOOKS_LIKE_JS_MAX_CONTENT;

		if (contentTooShort || hasOrphanImages || looksLikeJsPage) {
			// eslint-disable-next-line no-console
			console.debug(
				`Share to Save: 静态 HTML 内容不足 ` +
				`(text=${contentLen}chars, htmlSize=${html.length}, hasImgs=${htmlHasImgs}, mdHasImgs=${mdHasImages})，` +
				`尝试 headless / Static HTML insufficient, trying headless`,
			);
			const renderedHtml = await this.headlessExtractor.extractRenderedHtml(url);
			if (renderedHtml) {
				const reParsed = await this.parseWithDefuddle(renderedHtml, url);
				// 仅当 headless 结果更好时才替换 / Only replace if headless result is better
				if ((reParsed.content || '').length > contentLen) {
					// eslint-disable-next-line no-console
					console.debug(
						`Share to Save: Headless 提取成功 ` +
						`(content: ${contentLen} → ${(reParsed.content || '').length} chars)，` +
						`采用 headless 结果 / Headless succeeded, using headless result`,
					);
					parsed = reParsed;
				} else {
					// eslint-disable-next-line no-console
					console.debug(
						`Share to Save: Headless 结果未改善 (${(reParsed.content || '').length} ≤ ${contentLen})，` +
						`保持静态结果 / Headless result not better, keeping static`,
					);
				}
			}
		}

		// 4. 生成安全文件名 / Generate safe filename
		const safeTitle = this.sanitizeNoteTitle(parsed.title || 'Untitled');
		const notePath = normalizePath(`${this.settings.outputFolder}/${safeTitle}.md`);

		// 5. 构建 frontmatter + Markdown body / Build frontmatter + Markdown body
		const frontmatter = this.buildFrontmatter(parsed, url, stsId);
		let mdContent = frontmatter + '\n' + parsed.content;

		// 6. 处理图片/附件 / Process images/attachments
		mdContent = await this.imageHandler.processContent(mdContent, safeTitle);

		// 7. 确保输出目录存在 / Ensure output directory exists
		const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
		if (!dirExists) {
			await this.vault.createFolder(this.settings.outputFolder);
		}

		// 8. 写入 .md 文件 / Write .md file
		await this.vault.create(notePath, mdContent);

		return { success: true, title: safeTitle };
	}

	/**
	 * 通过 Node.js https/http.get 获取网页 HTML（支持 HTTP→HTTPS 重定向）
	 * Fetch webpage HTML via Node.js https/http.get (supports HTTP→HTTPS redirects)
	 */
	private async fetchHtml(url: string): Promise<string> {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const zlib: typeof import('zlib') = require('zlib');

		const parsedUrl = new URL(url);
		const protocol = parsedUrl.protocol === 'http:' ? 'http' : 'https';
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require(protocol) as typeof import('https');

		const html = await new Promise<string>((resolve, reject) => {
			const doRequest = (requestUrl: string, redirectCount = 0): void => {
				if (redirectCount > 10) {
					reject(new Error('重定向次数过多 / Too many redirects'));
					return;
				}

				const req = mod.get(requestUrl, {
					headers: {
						'User-Agent': CHROME_UA,
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
					},
				}, (res) => {
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
					if (encoding === 'gzip') {
						stream = res.pipe(zlib.createGunzip());
					} else if (encoding === 'deflate') {
						stream = res.pipe(zlib.createInflate());
					}

					stream.on('data', (chunk: Buffer) => chunks.push(chunk));
					stream.on('end', () => {
						const buffer = Buffer.concat(chunks);
						let text = buffer.toString('utf-8');
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
		const markdown = result.contentMarkdown
			?? result.content
			?? '';

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
			.slice(0, 200);
	}
}
