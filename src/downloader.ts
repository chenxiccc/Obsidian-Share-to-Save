/**
 * URL 内容下载器：HTML 获取 → 元数据提取 → 平台转换 → 保存 .md
 * URL content downloader: HTML acquisition → metadata extraction → platform conversion → save .md
 *
 * 仅在桌面端运行 / Desktop only
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings, Metadata } from './types';
import { CHROME_UA } from './types';
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
	 * 处理单个 URL：获取 HTML → 统一管线 → 保存 .md
	 * Process a single URL: acquire HTML → unified pipeline → save .md
	 *
	 * HTML 获取策略 / HTML acquisition strategy:
	 *   微信 → headless 直连（Node.js 大概率触发反爬，避免浪费请求）
	 *   其他 → Node.js https 优先 → SSR/质量检测 → headless 兜底
	 *
	 *   WeChat → headless directly (Node.js likely triggers anti-crawl)
	 *   Others → Node.js https first → SSR/quality check → headless fallback
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		const cleanUrl = Downloader.stripWeChatTrackingParams(url);

		const { html, canonicalUrl } = await this.acquireHtml(cleanUrl);

		if (!html) {
			return { success: false, error: '无法获取页面内容 / Failed to fetch page content' };
		}

		return this.processHtml(html, canonicalUrl, stsId);
	}

	/**
	 * HTML 获取：根据 URL 选择策略
	 * HTML acquisition: select strategy based on URL
	 */
	private async acquireHtml(url: string): Promise<{ html: string | null; canonicalUrl: string }> {
		// 微信：直接 headless / WeChat: straight to headless
		if (Downloader.isWeChatUrl(url)) {
			const html = await this.headlessExtractor.extractRenderedHtml(url);
			return { html, canonicalUrl: url };
		}

		// 其他：Node.js https 优先 / Others: Node.js https first
		const fetched = await this.fetchHtmlViaNodeJs(url);

		if (!fetched) {
			// Node.js 失败 → headless 兜底 / Node.js failed → headless fallback
			const html = await this.headlessExtractor.extractRenderedHtml(url);
			return { html, canonicalUrl: url };
		}

		if (Downloader.hasSsrState(fetched.html)) {
			if (!Downloader.isMinimallyViable(fetched.html)) {
				// SSR 框架返回空壳 → headless 兜底 / SSR shell → headless fallback
				const fallback = await this.headlessExtractor.extractRenderedHtml(url);
				if (fallback) return { html: fallback, canonicalUrl: url };
			}
			// SSR 页面且内容可用：保留原始 HTML（headless 可能丢失 __INITIAL_STATE__ 等数据）
			// SSR page with viable content: keep raw HTML (headless may lose __INITIAL_STATE__ data)
			return fetched;
		}

		if (Downloader.isQualityPoor(fetched.html)) {
			// 质量差 → headless 兜底 / Poor quality → headless fallback
			const fallback = await this.headlessExtractor.extractRenderedHtml(url);
			if (fallback) {
				return { html: fallback, canonicalUrl: url };
			}
		}

		return fetched;
	}

	/**
	 * 统一管线：HTML → DOMParser → metadata → converter → saveNote
	 * Unified pipeline: HTML → DOMParser → metadata → converter → saveNote
	 *
	 * 所有平台在 HTML 获取后共享此管线
	 * All platforms share this pipeline after HTML acquisition
	 */
	private async processHtml(html: string, url: string, stsId: string): Promise<ProcessResult> {
		// DOMParser 解析 / Parse with DOMParser
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');

		// 元数据：MetadataExtractor 统一提取 / Metadata: unified via MetadataExtractor
		const metadata = MetadataExtractor.extract(doc, html); // 传 raw HTML 用于提取 create_time / pass raw HTML for create_time extraction

		// 内容：分平台转换（findConverter 始终返回 converter，含 DefuddleConverter 兜底）
		// Content: platform-specific conversion (findConverter always returns a converter)
		const converter = findConverter(url);
		const result = converter.convert(doc, url, html);

		// 应用平台元数据修正 / Apply platform metadata patches
		Downloader.applyMetadataPatch(metadata, result.metadataPatch);

		// 图片 URL 提取 / Extract image URLs from markdown
		const imageUrls = Downloader.extractImageUrls(result.markdown);

		return this.saveNote({ ...metadata, content: result.markdown, imageUrls }, url, stsId);
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
					this.doNodeFetch(redirectUrl, redirectCount + 1, referer).then(resolve);
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

	// ── 质量与 SSR 检测 / Quality & SSR Detection ──────────────────────────

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
	 * 检测 HTML 是否包含 SSR 状态数据
	 * Detect if HTML contains SSR state data
	 *
	 * 有 SSR 状态的页面原始 HTML 包含完整数据（如 XHS 的 __INITIAL_STATE__），
	 * headless 可能因 JS 执行而丢失这些数据。检测到后跳过 headless 兜底。
	 */
	private static hasSsrState(html: string): boolean {
		return /window\.__INITIAL_STATE__\s*=|window\.__NUXT__\s*=|__NEXT_DATA__\s*=|window\.__DATA__\s*=/.test(html);
	}

	/**
	 * 快速检测 HTML 内容质量是否过差（需要 headless 兜底）
	 * Quick check if HTML content quality is too poor (needs headless fallback)
	 */
	private static isQualityPoor(html: string): boolean {
		// 太小 → 空/错误页 / Too small → empty/error page
		if (html.length < 500) return true;

		// 去脚本/样式后的纯文本 / Plain text after removing scripts/styles
		const text = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		// 文本太短 → 无意义 / Text too short → meaningless
		if (text.length < 100) return true;

		// HTML 很大但文本很少 → SPA 空壳 / Large HTML but little text → SPA shell
		if (html.length > 200_000 && text.length < 500) return true;

		return false;
	}

	/**
	 * 最小可行性检测：HTML 有基础内容，专用于 SSR 短路分支
	 * Minimal viability check: HTML has basic content, used only in SSR branch
	 *
	 * 不复用 isQualityPoor：后者的大文件规则（>200KB 且文本<500字符）对 SSR 页面不适用
	 * Does not reuse isQualityPoor: its large-file rule is inapplicable to SSR pages
	 */
	private static isMinimallyViable(html: string): boolean {
		if (html.length < 200) return false;
		const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
		return text.length >= 50;
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
