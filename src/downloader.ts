/**
 * URL 内容下载器：HTML 获取 → 元数据提取 → 平台转换 → 保存 .md
 * URL content downloader: HTML acquisition → metadata extraction → platform conversion → save .md
 *
 * 仅在桌面端运行 / Desktop only
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings, Metadata } from './types';
import { CHROME_UA, buildHeaders } from './http-utils';
import { sanitizeFilename, computeEffectiveContent, normalizeTitle } from './text-utils';
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

/** Node.js fetch 函数签名，handler 通过闭包获取 / Node.js fetch function signature, handlers capture via closure */
type FetchFn = (url: string, referer: string) => Promise<NodeFetchResult | null>;

/**
 * 网站获取策略处理器 / Site acquisition strategy handler
 *
 * 每个网站可自定义 matches（URL 匹配规则）和 acquire（获取策略）。
 * 新增网站只需实现此接口并注册到 siteHandlers 数组。
 * Each site defines matches (URL matching) and acquire (acquisition strategy).
 * Adding a new site means implementing this interface and registering in siteHandlers.
 */
interface SiteHandler {
	readonly name: string;
	matches(url: string): boolean;
	acquire(url: string): Promise<{ html: string | null; canonicalUrl: string | null }>;
}

/**
 * 微信 handler：headless 直连（已知 Node.js 反爬）
 * WeChat handler: headless directly (known Node.js anti-crawl)
 */
function createWechatHandler(headless: HeadlessExtractor): SiteHandler {
	return {
		name: 'WeChat',
		matches: (url) => /mp\.weixin\.qq\.com/.test(url),
		acquire: async (url) => {
			const html = await headless.extractRenderedHtml(url);
			return { html, canonicalUrl: null };
		},
	};
}

/**
 * 小红书 handler：Node.js https + Referer 伪装（已验证可行）
 * XHS handler: Node.js https + Referer spoofing (verified working)
 */
function createXhsHandler(fetchFn: FetchFn): SiteHandler {
	return {
		name: 'XHS',
		matches: (url) => /xiaohongshu\.com|xhslink\.com/i.test(url),
		acquire: async (url) => {
			const fetched = await fetchFn(url, 'https://www.xiaohongshu.com/');
			return { html: fetched?.html ?? null, canonicalUrl: fetched?.canonicalUrl ?? null };
		},
	};
}

/**
 * Obsidian Publish handler：Node.js 探测 SPA 壳 → enrich 取原始 MD，失败回退 headless
 * Obsidian Publish handler: Node.js detect SPA shell → enrich to raw MD, fallback to headless
 */
function createOpHandler(fetchFn: FetchFn, headless: HeadlessExtractor): SiteHandler {
	return {
		name: 'Obsidian Publish',
		matches: (url) => /obsidian\.md|publish\.obsidian\.md/i.test(url),
		acquire: async (url) => {
			const fetched = await fetchFn(url, new URL(url).origin);
			if (fetched && Downloader.isObsidianPublishShell(fetched.html)) {
				const enriched = await Downloader.enrichObsidianPublishHtml(fetched.html, url);
				if (enriched) return { html: enriched, canonicalUrl: fetched.canonicalUrl };
			}
			const html = await headless.extractRenderedHtml(url);
			return { html, canonicalUrl: null };
		},
	};
}

export class Downloader {
	/** OP 文件清单缓存 / OP file manifest cache (hash → filename → path)，跨页面复用 */
	private static opCacheMap = new Map<string, Map<string, string>>();

	private readonly imageHandler: ImageHandler;
	private readonly headlessExtractor: HeadlessExtractor;
	private readonly siteHandlers: SiteHandler[];

	constructor(
		private vault: Vault,
		private settings: ShareToSaveSettings,
		private t: Translator,
	) {
		this.imageHandler = new ImageHandler(vault, settings.outputFolder);
		this.headlessExtractor = new HeadlessExtractor();
		this.siteHandlers = [
			createWechatHandler(this.headlessExtractor),
			createXhsHandler((url, referer) => this.fetchHtmlViaNodeJs(url, referer)),
			createOpHandler((url, referer) => this.fetchHtmlViaNodeJs(url, referer), this.headlessExtractor),
		];
	}

	/**
	 * 处理单个 URL：获取 HTML → 转换管线 → 判断提取成功 → 保存/失败
	 * Process a single URL: acquire HTML → pipeline → check extraction success → save/fail
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		const cleanUrl = Downloader.stripWeChatTrackingParams(url);
		const { html, canonicalUrl } = await this.acquireHtml(cleanUrl);
		if (!html) {
			return { success: false, error: '无法获取页面内容 / Failed to fetch page content' };
		}

		const parsed = this.processDocToParsed(html, canonicalUrl);
		if (!parsed) {
			return { success: false, error: '无法提取页面内容 / Failed to extract page content' };
		}

		if (Downloader.isExtractionSuccessful(parsed)) {
			return this.saveNote(parsed, canonicalUrl, stsId, cleanUrl);
		}
		return this.saveFailedNote(canonicalUrl, cleanUrl, stsId, parsed);
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
	 * 判断管线输出是否提取成功：有文本或图片即成功，二值判断，无阈值。
	 * Check if pipeline output is extraction successful: any text or images = success, binary, no threshold.
	 */
	private static isExtractionSuccessful(parsed: ParsedContent): boolean {
		const hasText = computeEffectiveContent(parsed.content).length > 0;
		const hasImages = parsed.imageUrls.length > 0;
		return hasText || hasImages;
	}

	/**
	 * HTML 获取：遍历 siteHandlers 注册表，匹配则用其策略；都不匹配则默认 headless。
	 * HTML acquisition: iterate siteHandlers registry, use matched strategy; default to headless.
	 */
	private async acquireHtml(url: string): Promise<{ html: string | null; canonicalUrl: string }> {
		for (const handler of this.siteHandlers) {
			if (handler.matches(url)) {
				const result = await handler.acquire(url);
				return {
					html: result.html,
					canonicalUrl: result.canonicalUrl ?? Downloader.resolveCanonicalUrl(result.html, url),
				};
			}
		}
		// 默认：headless / Default: headless
		const html = await this.headlessExtractor.extractRenderedHtml(url);
		return { html, canonicalUrl: Downloader.resolveCanonicalUrl(html, url) };
	}

	/**
	 * 统一下游保存逻辑：sanitize → frontmatter → images → vault
	 * Unified downstream save: sanitize → frontmatter → images → vault
	 */
	private async saveNote(parsed: ParsedContent, canonicalUrl: string, stsId: string, inputUrl: string): Promise<ProcessResult> {
		const safeTitle = Downloader.sanitizeNoteTitle(parsed.title || 'Untitled');

		const frontmatter = Downloader.buildFrontmatter(parsed, inputUrl, stsId);
		let mdContent = frontmatter + '\n' + parsed.content;

		mdContent = await this.imageHandler.processContent(mdContent, safeTitle, canonicalUrl);

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
	 * 提取失败时生成占位笔记。
	 * Generate placeholder note when extraction fails.
	 *
	 * - parsed 有值（maybe_failed）：保留元数据 + 正文，打 maybe_failed 标签
	 * - parsed 无值（占位）：save_failed_HHmmss.md，仅 source + created
	 *
	 * url 用于日志/调试，inputUrl 用于 frontmatter source（与 saveNote 语义一致）。
	 * url is for logging/debugging; inputUrl is for frontmatter source (consistent with saveNote).
	 */
	async saveFailedNote(url: string, inputUrl?: string, stsId?: string, parsed?: ParsedContent): Promise<ProcessResult> {
		const now = new Date();
		const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
		if (!dirExists) {
			await this.vault.createFolder(this.settings.outputFolder);
		}

		if (parsed) {
			// maybe_failed 路径：保留已有元数据和正文，打标签
			// maybe_failed path: preserve existing metadata and content, tag as maybe_failed
			const baseTitle = parsed.title
				? (Downloader.sanitizeNoteTitle(parsed.title) || this.buildFallbackTitle(now))
				: this.buildFallbackTitle(now);

			const frontmatter = Downloader.buildFrontmatter(parsed, inputUrl || url, stsId || '', true);
			const body = parsed.content + '\n' + this.t('failed.body');
			const notePath = await this.resolveUniquePath(baseTitle);
			await this.vault.create(notePath, frontmatter + '\n' + body);

			return { success: true, title: baseTitle };
		}

		// 占位路径（无 parsed）：维持现有行为
		// Placeholder path (no parsed): preserve existing behavior
		const sourceForFrontmatter = inputUrl || url;
		const baseTitle = this.buildFallbackTitle(now);
		const notePath = await this.resolveUniquePath(baseTitle);
		const frontmatter = `---\nsource: "${sourceForFrontmatter}"\ncreated: ${now.toISOString().slice(0, 19)}\n---`;
		const body = this.t('failed.body');
		await this.vault.create(notePath, frontmatter + '\n' + body);

		return { success: true, title: baseTitle };
	}

	/**
	 * 生成 save_failed_HHmmss 回退文件名 / Build save_failed_HHmmss fallback filename
	 */
	private buildFallbackTitle(now: Date): string {
		const hh = String(now.getHours()).padStart(2, '0');
		const mm = String(now.getMinutes()).padStart(2, '0');
		const ss = String(now.getSeconds()).padStart(2, '0');
		return `save_failed_${hh}${mm}${ss}`;
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
	 * 通过 Node.js https 获取页面 HTML。referer 由调用方（handler）决定。
	 * Fetch page HTML via Node.js https. Referer is decided by the caller (handler).
	 */
	private fetchHtmlViaNodeJs(url: string, referer: string): Promise<NodeFetchResult | null> {
		return Downloader.doNodeFetch(url, 0, referer);
	}

	/**
	 * 递归获取 HTML，跟踪重定向 / Recursively fetch HTML, following redirects
	 */
	private static doNodeFetch(requestUrl: string, redirectCount: number, referer: string): Promise<NodeFetchResult | null> {
		if (redirectCount >= MAX_REDIRECTS) return Promise.resolve(null);

		const protocol = new URL(requestUrl).protocol === 'http:' ? 'http' : 'https';
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require(protocol) as typeof import('https');

		return new Promise<NodeFetchResult | null>((resolve) => {
			const headers = buildHeaders(referer, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
			const req = mod.get(requestUrl, { headers }, (res: import('http').IncomingMessage) => {
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

	/**
	 * 从 HTML 解析 canonical URL，失败则回退。处理 html 为 null 的情况。
	 * Resolve canonical URL from HTML, fallback if unavailable. Handles null html.
	 */
	private static resolveCanonicalUrl(html: string | null, fallbackUrl: string): string {
		if (html) {
			const canonical = Downloader.extractCanonicalUrl(html);
			if (canonical) return canonical;
		}
		return fallbackUrl;
	}

	// ── Obsidian Publish / Obsidian Publish ──────────────────────────────────

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
	static extractObsidianPublishApiUrl(html: string): string | null {
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
	static isObsidianPublishShell(html: string): boolean {
		return /window\.preloadPage=f\("https?:\/\/[^"]+\.md"\)/.test(html);
	}

	/**
	 * 从 SPA 壳 HTML 提取 siteInfo（uid + host），用于后续 cache endpoint 请求
	 * Extract siteInfo (uid + host) from SPA shell HTML for cache endpoint requests
	 */
	static extractSiteInfo(html: string): { uid: string; host: string } | null {
		const siteInfoMatch = html.match(/window\.siteInfo\s*=\s*({[^}]+})/);
		const siteInfoJson = siteInfoMatch?.[1];
		if (!siteInfoJson) return null;
		try {
			const info = JSON.parse(siteInfoJson) as { uid?: string; host?: string };
			if (info.uid && info.host) return { uid: info.uid, host: info.host };
		} catch { /* JSON 解析失败 / JSON parse failure */ }
		return null;
	}

	/**
	 * 获取 OP 文件清单，按 hash 内存缓存（首次 fetch，后续命中缓存）
	 * Fetch OP file manifest, cached by hash in memory (fetched once, cached thereafter)
	 *
	 * 返回 Map<filename, vaultRelativePath>，如 "command.png" → "Assets/command.png"
	 * Returns Map<filename, vaultRelativePath>, e.g. "command.png" → "Assets/command.png"
	 */
	private static async fetchObsidianPublishCache(host: string, uid: string): Promise<Map<string, string> | null> {
		const cacheKey = `${host}/${uid}`;
		const cached = Downloader.opCacheMap.get(cacheKey);
		if (cached) return cached;

		const url = `https://${host}/cache/${uid}`;
		try {
			const result = await Downloader.doNodeFetch(url, 0, `https://${host}/`);
			if (!result) return null;
			const data = JSON.parse(result.html) as Record<string, unknown>;
			const fileMap = new Map<string, string>();
			for (const filePath of Object.keys(data)) {
				const filename = filePath.split('/').pop()!;
				// 同名文件以第一个为准（vault 内文件名不应重复）
				// First occurrence wins for duplicate filenames (shouldn't exist in vault)
				if (!fileMap.has(filename)) {
					fileMap.set(filename, filePath);
				}
			}
			Downloader.opCacheMap.set(cacheKey, fileMap);
			return fileMap;
		} catch {
			return null;
		}
	}

	/**
	 * 将 OP 原始 Markdown 中的 ![[image.png]] wikilink 解析为 ![](CDN绝对URL)。
	 * Resolve ![[image.png]] wikilinks in OP raw Markdown to ![](CDN absolute URL).
	 *
	 * 优先通过 fileMap（fetchObsidianPublishCache 返回）查找精确路径，
	 * fileMap 不可用时回退硬编码 Assets/（当前行为）。
	 * Prefer exact path via fileMap (from fetchObsidianPublishCache),
	 * fallback to hardcoded Assets/ when fileMap unavailable (current behavior).
	 *
	 * 非图片 wikilink（如 .md 笔记嵌入）保持原样。
	 * Non-image wikilinks (e.g. .md note embeds) are left unchanged.
	 *
	 * @param markdown 原始 Markdown / Raw Markdown
	 * @param fileMap  文件名→路径映射（null 时回退 Assets/）/ filename→path map (fallback to Assets/ when null)
	 * @param cdnBase CDN 根路径（不含 Assets/），如 https://.../access/{hash}/
	 */
	static resolveWikilinkImages(markdown: string, fileMap: Map<string, string> | null, cdnBase: string): string {
		const IMAGE_WIKILINK_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|svg|webp|bmp|ico))\]\]/gi;
		return markdown.replace(IMAGE_WIKILINK_RE, (_full: string, filename: string) => {
			if (fileMap) {
				const filePath = fileMap.get(filename);
				if (filePath) {
					return `![](${cdnBase}${encodeURIComponent(filePath)})`;
				}
			}
			// 回退硬编码 Assets/ / Fallback to hardcoded Assets/
			return `![](${cdnBase}Assets/${encodeURIComponent(filename)})`;
		});
	}

	/**
	 * 从 SPA 壳提取 API URL → fetch 原始 Markdown + 文件清单 → 合成 HTML。
	 * Extract API URL from SPA shell → fetch raw Markdown + file manifest → synthesize HTML.
	 *
	 * 步骤 / Steps:
	 *   1. extractObsidianPublishApiUrl → 提取 MD API URL
	 *   2. extractSiteInfo → 提取 uid + host
	 *   3. doNodeFetch(apiUrl) → 获取原始 Markdown
	 *   4. fetchObsidianPublishCache(host, uid) → 获取文件清单（内存缓存，首次请求）
	 *   5. resolveWikilinkImages(md, fileMap, cdnBase) → 解析 ![[image.png]] wikilink
	 *   6. 合成 HTML：<head> 元数据 + <script id="publish-markdown"> 嵌入 MD
	 *
	 * 合成 HTML 保留 <head> 元数据（供 MetadataExtractor 使用），
	 * <body> 中嵌入 <script id="publish-markdown"> 存放原始 MD（供 ObsidianPublishConverter 提取）。
	 * Synthesized HTML preserves <head> metadata (for MetadataExtractor),
	 * body embeds raw MD in <script id="publish-markdown"> (for ObsidianPublishConverter).
	 */
	static async enrichObsidianPublishHtml(shellHtml: string, url: string): Promise<string | null> {
		const apiUrl = Downloader.extractObsidianPublishApiUrl(shellHtml);
		if (!apiUrl) return null;

		const mdResult = await Downloader.doNodeFetch(apiUrl, 0, new URL(url).origin);
		if (!mdResult) return null;

		// 获取文件清单以精确解析 wikilink 路径（首次 fetch，后续命中内存缓存）
		// Get file manifest for exact wikilink path resolution (fetched once, cached in memory)
		const siteInfo = Downloader.extractSiteInfo(shellHtml);
		let fileMap: Map<string, string> | null = null;
		if (siteInfo) {
			fileMap = await Downloader.fetchObsidianPublishCache(siteInfo.host, siteInfo.uid);
		}

		// CDN base 不含 Assets/（由 resolveWikilinkImages 内部处理）
		// CDN base without Assets/ (handled internally by resolveWikilinkImages)
		const cdnMatch = apiUrl.match(/^(.*\/access\/[^/]+\/)/);
		const cdnBase = cdnMatch?.[1] ?? '';

		const resolvedMd = Downloader.resolveWikilinkImages(mdResult.html, fileMap, cdnBase);

		// 保留 SPA 壳 <head> 内容（title、og:description 等 meta 标签）
		// Preserve SPA shell <head> content (title, og:description, etc.)
		const headMatch = shellHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
		const headContent = headMatch?.[1] ?? '<meta charset="utf-8">';

		// 转义 Markdown 中极罕见的 </script> 字符串
		// Escape extremely rare </script> in Markdown
		const safeMd = resolvedMd.replace(/<\/script>/gi, '<\\/script>');

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
	 *
	 * maybeFailed 为 true 时在 sts_id 后插入 tags: maybe_failed，
	 * 使 Obsidian Tags 面板、搜索、图谱原生支持。
	 * When maybeFailed is true, inserts tags: maybe_failed after sts_id,
	 * enabling native Obsidian Tags panel, search, and graph support.
	 */
	static buildFrontmatter(
		parsed: ParsedContent,
		sourceUrl: string,
		stsId: string,
		maybeFailed?: boolean,
	): string {
		const lines: string[] = ['---'];
		lines.push(`source: "${sourceUrl}"`);
		lines.push(`sts_id: "${stsId}"`);

		if (maybeFailed) {
			lines.push('tags:');
			lines.push('  - maybe_failed');
		}

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
		return sanitizeFilename(normalizeTitle(title));
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
