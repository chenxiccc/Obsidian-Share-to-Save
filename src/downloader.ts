/**
 * URL 内容下载器：HTML 获取 → 元数据提取 → 平台转换 → 保存 .md
 * URL content downloader: HTML acquisition → metadata extraction → platform conversion → save .md
 *
 * 仅在桌面端运行 / Desktop only
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings, Metadata } from './types';
import { CHROME_UA } from './types';
import { sanitizeFilename, isMarkdownViable } from './text-utils';
import { ImageHandler } from './image-handler';
import type { Translator } from './i18n';
import { HeadlessExtractor } from './headless-extractor';
import { findConverter } from './content-converter';
import { MetadataExtractor } from './metadata-extractor';

/** 最大重定向次数 / Maximum redirect hops */
const MAX_REDIRECTS = 5;
/** 请求超时（毫秒）/ Request timeout (ms) */
const REQUEST_TIMEOUT_MS = 30_000;

/** Node.js HTML 获取结果 / Node.js HTML fetch result */
interface NodeFetchResult {
	html: string;
	canonicalUrl: string;
}

export class Downloader {
	private readonly imageHandler: ImageHandler;
	private readonly headlessExtractor: HeadlessExtractor;

	constructor(
		private vault: Vault,
		private settings: ShareToSaveSettings,
		private t: Translator,
	) {
		this.imageHandler = new ImageHandler(vault, settings.outputFolder);
		this.headlessExtractor = new HeadlessExtractor();
	}

	/**
	 * 处理单个 URL：两阶段获取 → 统一管线 → 保存 .md
	 * Process a single URL: two-phase acquisition → unified pipeline → save .md
	 *
	 * Phase 1: Node.js → pipeline → isMarkdownViable? → save
	 * Phase 2: headless fallback (only if Phase 1 didn't try headless)
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		const cleanUrl = Downloader.stripWeChatTrackingParams(url);
		const { html, canonicalUrl, triedHeadless } = await this.acquireHtml(cleanUrl);
		if (!html) {
			return { success: false, error: '无法获取页面内容 / Failed to fetch page content' };
		}

		// Phase 1: 转换 + 输出质量评估 / Convert + output quality assessment
		const parsed = this.processDocToParsed(html, canonicalUrl);
		if (parsed && isMarkdownViable(parsed.content)) {
			return this.saveNote(parsed, canonicalUrl, stsId);
		}

		// Phase 2: Headless 兜底（Phase 1 未尝试 headless 时）/ Headless fallback (only if Phase 1 didn't try headless)
		if (!triedHeadless) {
			const headlessHtml = await this.headlessExtractor.extractRenderedHtml(cleanUrl);
			if (headlessHtml) {
				const headlessParsed = this.processDocToParsed(headlessHtml, cleanUrl);
				if (headlessParsed) {
					return this.saveNote(headlessParsed, cleanUrl, stsId);
				}
			}
		}

		// Phase 1 有部分内容则尽力保存 / Best effort: save Phase 1 result
		if (parsed) {
			return this.saveNote(parsed, canonicalUrl, stsId);
		}
		return { success: false, error: '无法提取页面内容 / Failed to extract page content' };
	}

	/**
	 * 统一转换管线：HTML → DOMParser → Metadata → Converter → ParsedContent
	 * Unified pipeline shared by Phase 1 and Phase 2. Pure computation, no side effects.
	 */
	private processDocToParsed(html: string, url: string): ParsedContent | null {
		try {
			const doc = new DOMParser().parseFromString(html, 'text/html');
			const metadata = MetadataExtractor.extract(doc, html);
			const converter = findConverter(url);
			const result = converter.convert(doc, url, html);
			Downloader.applyMetadataPatch(metadata, result.metadataPatch);
			const content = result.markdown;
			const imageUrls = Downloader.extractImageUrls(content);
			return { ...metadata, content, imageUrls };
		} catch (err) {
			console.warn('Share to Save: 转换管线失败 / Pipeline failed:', err);
			return null;
		}
	}

	/**
	 * HTML 获取：微信直连 headless，其他走 Node.js https。
	 * HTML acquisition: WeChat → headless directly, others → Node.js https.
	 */
	private async acquireHtml(url: string): Promise<{ html: string | null; canonicalUrl: string; triedHeadless: boolean }> {
		// WeChat: headless 直连（已知反爬，Node.js 大概率返回验证页）
		// WeChat: headless directly (known anti-crawl, Node.js likely returns captcha)
		if (Downloader.isWeChatUrl(url)) {
			const html = await this.headlessExtractor.extractRenderedHtml(url);
			return { html, canonicalUrl: url, triedHeadless: true };
		}

		// Node.js https 优先 / Node.js https first
		const fetched = await this.fetchHtmlViaNodeJs(url);
		if (fetched) {
			// Obsidian Publish SPA 壳检测（内容模式，非域名）→ fetch 原始 MD → 合成 HTML
			// Obsidian Publish SPA shell detection (content pattern, not domain) → fetch raw MD → synthesize HTML
			if (Downloader.isObsidianPublishShell(fetched.html)) {
				const enriched = await this.enrichObsidianPublishHtml(fetched.html, url);
				if (enriched) {
					return { html: enriched, canonicalUrl: fetched.canonicalUrl, triedHeadless: false };
				}
			}
			return { html: fetched.html, canonicalUrl: fetched.canonicalUrl, triedHeadless: false };
		}

		// Node.js 失败 → headless 兜底 / Node.js failed → headless fallback
		const html = await this.headlessExtractor.extractRenderedHtml(url);
		return { html, canonicalUrl: url, triedHeadless: true };
	}

	/**
	 * 统一下游保存逻辑：sanitize → frontmatter → images → vault
	 * Unified downstream save: sanitize → frontmatter → images → vault
	 */
	private async saveNote(parsed: ParsedContent, sourceUrl: string, stsId: string): Promise<ProcessResult> {
		const safeTitle = Downloader.sanitizeNoteTitle(parsed.title || 'Untitled');

		const frontmatter = Downloader.buildFrontmatter(parsed, sourceUrl, stsId);
		let mdContent = frontmatter + '\n' + parsed.content;

		mdContent = await this.imageHandler.processContent(mdContent, safeTitle);

		const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
		if (!dirExists) {
			await this.vault.createFolder(this.settings.outputFolder);
		}

		// 处理同名文件：递增编号 / Handle duplicate filenames: increment counter
		const finalPath = await this.resolveUniquePath(safeTitle);
		await this.vault.create(finalPath, mdContent);

		return { success: true, title: safeTitle };
	}

	/**
	 * 解析唯一文件路径：标题重复时递增编号
	 * Resolve unique file path: increment counter when title conflicts
	 */
	private async resolveUniquePath(baseTitle: string): Promise<string> {
		let title = baseTitle;
		let counter = 1;
		let notePath = normalizePath(`${this.settings.outputFolder}/${title}.md`);
		while (await this.vault.adapter.exists(notePath)) {
			title = `${baseTitle} ${counter}`;
			notePath = normalizePath(`${this.settings.outputFolder}/${title}.md`);
			counter++;
		}
		return notePath;
	}

	/**
	 * 提取失败时生成占位笔记
	 * Generate placeholder note when extraction fails
	 */
	async saveFailedNote(url: string): Promise<void> {
		const now = new Date();
		const hh = String(now.getHours()).padStart(2, '0');
		const mm = String(now.getMinutes()).padStart(2, '0');
		const ss = String(now.getSeconds()).padStart(2, '0');
		const baseTitle = `save_failed_${hh}${mm}${ss}`;

		const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
		if (!dirExists) {
			await this.vault.createFolder(this.settings.outputFolder);
		}

		const notePath = await this.resolveUniquePath(baseTitle);
		const frontmatter = `---\nsource: "${url}"\ncreated: ${now.toISOString().slice(0, 19)}\n---`;
		const body = this.t('failed.body');
		await this.vault.create(notePath, frontmatter + '\n' + body);
	}

	/**
	 * 应用平台提供的元数据修正（如 XHS 标题去" - 小红书"后缀）
	 * Apply platform-provided metadata patches (e.g. XHS title suffix removal)
	 */
	private static applyMetadataPatch(metadata: Metadata, patch?: Partial<Metadata>): void {
		if (!patch) return;
		if (patch.title) metadata.title = patch.title;
		if (patch.author) metadata.author = patch.author;
		if (patch.published) metadata.published = patch.published;
	}

	// ── Node.js https HTML 获取 / Node.js https HTML Fetch ──────────────────

	/**
	 * 通过 Node.js https 获取页面 HTML
	 * Fetch page HTML via Node.js https
	 *
	 * 小红书需要特定 Referer 绕过防盗链，其他页面使用 origin 即可
	 * XHS needs specific Referer for anti-hotlink; others use origin
	 */
	private fetchHtmlViaNodeJs(url: string): Promise<NodeFetchResult | null> {
		const isXhs = /xiaohongshu\.com|xhslink\.com/i.test(url);
		const referer = isXhs ? 'https://www.xiaohongshu.com/' : new URL(url).origin;
		return this.doNodeFetch(url, 0, referer);
	}

	/**
	 * 递归获取 HTML，跟踪重定向 / Recursively fetch HTML, following redirects
	 */
	private doNodeFetch(requestUrl: string, redirectCount: number, referer: string): Promise<NodeFetchResult | null> {
		if (redirectCount >= MAX_REDIRECTS) return Promise.resolve(null);

		const protocol = new URL(requestUrl).protocol === 'http:' ? 'http' : 'https';
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require(protocol) as typeof import('https');

		return new Promise<NodeFetchResult | null>((resolve) => {
			const req = mod.get(requestUrl, {
				headers: {
					'User-Agent': CHROME_UA,
					'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Referer': referer,
				},
			}, (res: import('http').IncomingMessage) => {
				// 处理重定向 / Handle redirect
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					const redirectUrl = new URL(res.headers.location, requestUrl).toString();
					res.resume();
					void this.doNodeFetch(redirectUrl, redirectCount + 1, referer).then(resolve);
					return;
				}

				// 非 200 → 失败 / Non-200 → failure
				if (!res.statusCode || res.statusCode >= 400) {
					res.resume();
					resolve(null);
					return;
				}

				// 收集响应体 / Collect response body
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					const htmlText = Buffer.concat(chunks).toString('utf-8');
					const canonical = Downloader.extractCanonicalUrl(htmlText) || requestUrl;
					resolve({ html: htmlText, canonicalUrl: canonical });
				});
				res.on('error', () => resolve(null));
			});

			req.on('error', () => resolve(null));
			req.setTimeout(REQUEST_TIMEOUT_MS, () => {
				req.destroy();
				resolve(null);
			});
		});
	}

	/**
	 * 从 HTML 中提取 canonical URL（og:url meta 标签）
	 * Extract canonical URL from HTML (og:url meta tag)
	 */
	private static extractCanonicalUrl(html: string): string | null {
		const match = html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]*)"/i);
		return match?.[1] ?? null;
	}

	// ── 域名检测 / Domain Detection ──────────────────────────────────────

	/**
	 * 检测是否为微信 URL / Check if WeChat URL
	 *
	 * 唯一需要跳过 Node.js 直连 headless 的域名。
	 * Only domain that needs to skip Node.js entirely.
	 */
	private static isWeChatUrl(url: string): boolean {
		return /mp\.weixin\.qq\.com/.test(url);
	}

	/**
	 * 检测是否为 Obsidian Publish URL / Check if Obsidian Publish URL
	 *
	 * Obsidian Publish 返回 SPA 空壳，真实内容通过 window.preloadPage API 异步加载。
	 * Obsidian Publish returns a SPA shell; real content loads via window.preloadPage API.
	 */
	/**
	 * 从 SPA 壳 HTML 中提取 Obsidian Publish 的原始 Markdown API URL
	 * Extract Obsidian Publish raw Markdown API URL from SPA shell HTML
	 */
	private static extractObsidianPublishApiUrl(html: string): string | null {
		const match = html.match(/window\.preloadPage=f\("([^"]+)"\)/);
		return match?.[1] ?? null;
	}

	/**
	 * 检测 HTML 是否为 Obsidian Publish SPA 空壳（内容模式检测，非域名）
	 * Check if HTML is an Obsidian Publish SPA shell (content pattern, not domain)
	 *
	 * SPA 壳特征：window.preloadPage 指向 .md API URL。
	 * 仅检测内容模式，不依赖域名，因此自定义域名也能覆盖。
	 * SPA shell signature: window.preloadPage points to .md API URL.
	 * Content-pattern based, so custom domains are automatically covered.
	 */
	private static isObsidianPublishShell(html: string): boolean {
		return /window\.preloadPage=f\("https?:\/\/[^"]+\.md"\)/.test(html);
	}

	/**
	 * 从 SPA 壳提取 API URL → fetch 原始 Markdown → 合成 HTML
	 * Extract API URL from SPA shell → fetch raw Markdown → synthesize HTML
	 *
	 * 合成 HTML 保留 <head> 元数据（供 MetadataExtractor 使用），
	 * <body> 中嵌入 <script id="publish-markdown"> 存放原始 MD（供 ObsidianPublishConverter 提取）。
	 * Synthesized HTML preserves <head> metadata (for MetadataExtractor),
	 * body embeds raw MD in <script id="publish-markdown"> (for ObsidianPublishConverter).
	 */
	private async enrichObsidianPublishHtml(shellHtml: string, url: string): Promise<string | null> {
		const apiUrl = Downloader.extractObsidianPublishApiUrl(shellHtml);
		if (!apiUrl) return null;

		const mdResult = await this.doNodeFetch(apiUrl, 0, new URL(url).origin);
		if (!mdResult) return null;

		// 保留 SPA 壳 <head> 内容（title、og:description 等 meta 标签）
		// Preserve SPA shell <head> content (title, og:description, etc.)
		const headMatch = shellHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
		const headContent = headMatch?.[1] ?? '<meta charset="utf-8">';

		// 转义 Markdown 中极罕见的 </script> 字符串
		// Escape extremely rare </script> in Markdown
		const safeMd = mdResult.html.replace(/<\/script>/gi, '<\\/script>');

		return `<!DOCTYPE html><html><head>${headContent}</head><body><script type="text/plain" id="publish-markdown">${safeMd}<\/script></body></html>`;
	}




	// ── 工具方法 / Utility Methods ──────────────────────────────────────────

	/**
	 * 从 Markdown 中提取所有外链图片 URL
	 * Extract all external image URLs from Markdown
	 */
	static extractImageUrls(markdown: string): string[] {
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
	 * 构建 YAML frontmatter / Build YAML frontmatter
	 */
	static buildFrontmatter(
		parsed: ParsedContent,
		sourceUrl: string,
		stsId: string,
	): string {
		const lines: string[] = ['---'];
		lines.push(`source: "${sourceUrl}"`);
		lines.push(`sts_id: "${stsId}"`);

		if (parsed.author) {
			lines.push('author:');
			lines.push(`  - "${parsed.author}"`);
		}

		if (parsed.published) {
			const formatted = Downloader.formatDateTime(parsed.published);
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
	static formatDateTime(input: string): string | null {
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
	static sanitizeNoteTitle(title: string): string {
		return sanitizeFilename(title, 200);
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
