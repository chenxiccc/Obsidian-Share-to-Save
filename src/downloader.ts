/**
 * URL 内容下载器：HTML 获取 → defuddle 解析 → 图片处理 → .md 保存
 * URL content downloader: fetch HTML → defuddle parse → image processing → save .md
 *
 * 仅在桌面端运行（依赖 Node.js https/http）/ Desktop only (depends on Node.js https/http)
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings } from './types';
import { ImageHandler } from './image-handler';
import Defuddle from 'defuddle/full';
import type { DefuddleOptions } from 'defuddle/full';
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
		// 剥离微信追踪参数，避免反爬拦截 / Strip WeChat tracking params to avoid anti-crawl
		const cleanUrl = Downloader.stripWeChatTrackingParams(url);

		// 1. Tier 1: 下载静态 HTML / Tier 1: download static HTML
		const html = await this.fetchHtml(cleanUrl);

		// 2. defuddle 解析 / Parse with defuddle
		let parsed = this.parseWithDefuddle(html, cleanUrl);

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
			const renderedHtml = await this.headlessExtractor.extractRenderedHtml(cleanUrl);
			if (renderedHtml && HeadlessExtractor.hasWeChatContent(renderedHtml)) {
				const reParsed = this.parseWithDefuddle(renderedHtml, cleanUrl);
				if ((reParsed.content || '').length > contentLen) {
					parsed = reParsed;
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
	 * 根据 URL 确定 defuddle 的 contentSelector 参数
	 * Determine defuddle contentSelector based on URL
	 *
	 * 特定网站指定内容容器选择器，避免 defuddle 在整页中提取出 JS/UI 残渣
	 * Specify content container selector for specific sites to prevent JS/UI artifacts in extraction
	 */
	private getContentSelector(url: string): string | undefined {
		if (/mp\.weixin\.qq\.com/.test(url)) {
			return '#js_content';
		}
		return undefined;
	}

	/**
	 * 调用 defuddle/full 解析 HTML → Markdown
	 * Parse HTML → Markdown via defuddle/full (browser API, DOMParser)
	 *
	 * 参考 ima-copilot-sync html-to-md.ts 实现 / Based on ima-copilot-sync's html-to-md.ts
	 * 关键：使用 DOMParser（Electron 原生）解析 HTML，而非 linkedom（会因复杂 HTML 失败）
	 * Key: use DOMParser (Electron native) to parse HTML, not linkedom (fails on complex HTML)
	 */
	private parseWithDefuddle(html: string, url: string): ParsedContent {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');

		const defuddleOpts: DefuddleOptions = {
			url,
			markdown: true,
			useAsync: false,
		};

		const contentSelector = this.getContentSelector(url);
		if (contentSelector) {
			defuddleOpts.contentSelector = contentSelector;
		}

		const result = new Defuddle(doc, defuddleOpts).parse();

		let markdown = result.content ?? '';

		// 补充提取 defuddle 遗漏的图片（参考 extractWeChatImages）
		// 微信等页面使用 data-src 懒加载、cdn_url 等 defuddle 无法识别的模式
		// Supplementary image extraction for images defuddle missed
		// WeChat etc. use data-src lazy loading, cdn_url patterns defuddle can't recognize
		const supplementaryImages = this.extractSupplementaryImages(html, doc, markdown);
		if (supplementaryImages) {
			markdown = markdown.trimEnd() + '\n' + supplementaryImages;
		}

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
	 * 标准化图片 URL 用于去重（去除查询参数，统一子域名）
	 * Normalize image URL for dedup (strip query params, normalize subdomain)
	 *
	 * 参考 ima-copilot-sync html-to-md.ts normalizeImgUrl
	 * Based on ima-copilot-sync's html-to-md.ts normalizeImgUrl
	 */
	private normalizeImgUrl(url: string): string {
		try {
			const u = new URL(url);
			return u.origin + u.pathname;
		} catch {
			const idx = url.indexOf('?');
			return idx >= 0 ? url.substring(0, idx) : url;
		}
	}

	/**
	 * 补充提取 HTML 中 defuddle 遗漏的图片（用于 data-src 懒加载、cdn_url 等模式）
	 * Supplementary image extraction for images defuddle missed (data-src, cdn_url, etc.)
	 *
	 * 参考 ima-copilot-sync html-to-md.ts extractWeChatImages / Based on ima-copilot-sync's extractWeChatImages
	 */
	private extractSupplementaryImages(html: string, doc: Document, existingContent: string): string {
		const seen = new Set<string>();
		const seenNormalized = new Set<string>();
		const parts: string[] = [];

		// 先收集已有 Markdown 中的图片 URL 用于去重 / Collect existing Markdown image URLs for dedup
		const mdImgRegex = /!\[.*\]\((https?:\/\/[^)]+)\)/g;
		let mdMatch: RegExpExecArray | null;
		while ((mdMatch = mdImgRegex.exec(existingContent)) !== null) {
			if (mdMatch[1]) {
				seen.add(mdMatch[1]);
				seenNormalized.add(this.normalizeImgUrl(mdMatch[1]));
			}
		}

		// 全 DOM 搜索 img，优先 data-src（懒加载），回退 src
		// Full DOM img search, prefer data-src (lazy loading), fallback to src
		// from=appmsg 过滤推荐缩略图 / from=appmsg filter excludes recommendation thumbnails
		for (const img of Array.from(doc.querySelectorAll('img'))) {
			const imgUrl = img.getAttribute('data-src') || img.src;
			if (!imgUrl || !/^https?:\/\//.test(imgUrl)) continue;
			if (imgUrl.includes('pic_blank.gif')) continue;
			if (imgUrl.includes('res.wx.qq.com/mmbizappmsg')) continue;
			if (!imgUrl.includes('from=appmsg')) continue;
			const normalized = this.normalizeImgUrl(imgUrl);
			if (seen.has(imgUrl) || seenNormalized.has(normalized)) continue;
			seen.add(imgUrl);
			seenNormalized.add(normalized);
			parts.push(`![${(img as HTMLImageElement).alt || ''}](${imgUrl})`);
		}

		// cdn_url 中含 from=appmsg 的正文图片（轮播隐藏图不在 DOM 中）
		// Content images from cdn_url with from=appmsg (hidden swiper images not in DOM)
		const cdnRegex = /cdn_url\s*:\s*['"](https?:\/\/[^'"]*?from=appmsg[^'"]*?)['"]/gi;
		let cdnMatch: RegExpExecArray | null;
		while ((cdnMatch = cdnRegex.exec(html)) !== null) {
			const imgUrl = cdnMatch[1] as string;
			const normalized = this.normalizeImgUrl(imgUrl);
			if (seen.has(imgUrl) || seenNormalized.has(normalized)) continue;
			seen.add(imgUrl);
			seenNormalized.add(normalized);
			parts.push(`![](${imgUrl})`);
		}

		// data-src 模式（HTML 源码级别，可能不在 DOM 中）/ data-src pattern (HTML source level, may not be in DOM)
		const dataSrcRegex = /data-src="(https?:\/\/[^"]+?(?:mmbiz|qpic)[^"]*?(?:jpe?g|png|gif|webp)[^"]*?)"/gi;
		let dsMatch: RegExpExecArray | null;
		while ((dsMatch = dataSrcRegex.exec(html)) !== null) {
			const imgUrl = dsMatch[1] as string;
			if (imgUrl.includes('pic_blank.gif')) continue;
			if (imgUrl.includes('res.wx.qq.com/mmbizappmsg')) continue;
			if (seen.has(imgUrl)) continue;
			seen.add(imgUrl);
			parts.push(`![](${imgUrl})`);
		}

		return parts.length > 0 ? parts.join('\n') + '\n' : '';
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

	/**
	 * 剥离微信文章 URL 中的跟踪参数，仅保留文章标识
	 * Strip WeChat article URL tracking params, keep only article identifiers
	 *
	 * 参考 ima-copilot-sync sync-manager.ts stripWeChatTrackingParams
	 * Based on ima-copilot-sync's sync-manager.ts stripWeChatTrackingParams
	 */
	static stripWeChatTrackingParams(url: string): string {
		try {
			const parsed = new URL(url);
			if (!parsed.hostname.endsWith('weixin.qq.com') && !parsed.hostname.endsWith('mp.weixin.qq.com')) {
				return url;
			}
			const keep = ['__biz', 'mid', 'idx', 'sn'];
			const cleaned = new URL('https://mp.weixin.qq.com/s');
			for (const key of keep) {
				const val = parsed.searchParams.get(key);
				if (val) cleaned.searchParams.set(key, val);
			}
			if (cleaned.searchParams.toString() === '') return url;
			return cleaned.toString();
		} catch {
			return url;
		}
	}
}
