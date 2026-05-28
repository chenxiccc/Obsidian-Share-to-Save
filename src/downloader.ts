/**
 * URL 内容下载器：headless BrowserWindow 获取渲染 HTML → defuddle 解析 → 保存 .md
 * URL content downloader: headless BrowserWindow → defuddle parse → save .md
 *
 * 仅在桌面端运行 / Desktop only
 */

import { Vault, normalizePath } from 'obsidian';
import type { ParsedContent, ProcessResult, ShareToSaveSettings } from './types';
import { ImageHandler } from './image-handler';
import Defuddle from 'defuddle/full';
import { HeadlessExtractor } from './headless-extractor';
import { findConverter } from './content-converter';
import { isXiaohongshuUrl, fetchXhsHtml } from './xhs-extractor';

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
	 * 处理单个 URL：获取 HTML → 统一管线 → 保存 .md
	 * Process a single URL: acquire HTML → unified pipeline → save .md
	 *
	 * HTML 获取是唯一分叉点：XHS 走 Node.js https，其他走 headless BrowserWindow
	 * HTML acquisition is the only branch point: XHS uses Node.js https, others use headless
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		// 剥离微信追踪参数 / Strip WeChat tracking params
		const cleanUrl = Downloader.stripWeChatTrackingParams(url);

		// ── HTML 获取（唯一分叉点）/ HTML acquisition (only branch point) ──
		let html: string | null;
		let canonicalUrl = cleanUrl;

		if (isXiaohongshuUrl(cleanUrl)) {
			// XHS: Node.js https 直接获取（SSR HTML 已包含完整数据）
			// XHS: Node.js https direct fetch (SSR HTML contains all data)
			const fetched = await fetchXhsHtml(cleanUrl);
			if (!fetched) {
				return { success: false, error: '无法获取小红书页面 / Failed to fetch XHS page' };
			}
			html = fetched.html;
			canonicalUrl = fetched.canonicalUrl;
		} else {
			// headless BrowserWindow 获取渲染 HTML / Get rendered HTML via headless BrowserWindow
			html = await this.headlessExtractor.extractRenderedHtml(cleanUrl);
		}

		if (!html) {
			return { success: false, error: '无法获取页面内容 / Failed to fetch page content' };
		}

		return this.processHtml(html, canonicalUrl, stsId);
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

		// 元数据：defuddle 统一提取 / Metadata: always from defuddle
		const metadata = this.extractMetadata(doc, url);

		// XHS: defuddle 从 <title> 提取的标题含 " - 小红书" 后缀，去除
		//      authorUrl 可能是相对路径（/user/profile/xxx），补全域名
		// XHS: defuddle extracts title from <title> with " - 小红书" suffix, strip it
		//      authorUrl may be relative (/user/profile/xxx), prepend domain
		if (isXiaohongshuUrl(url)) {
			metadata.title = metadata.title.replace(/\s*-\s*小红书\s*$/, '').trim() || metadata.title;
			if (metadata.authorUrl && metadata.authorUrl.startsWith('/')) {
				metadata.authorUrl = 'https://www.xiaohongshu.com' + metadata.authorUrl;
			}
		}

		// 内容：分平台转换 / Content: platform-specific conversion
		const converter = findConverter(url);
		let content: string;
		let imageUrls: string[];

		if (converter) {
			// 有平台转换器 → 转换 / Has converter → convert
			content = converter.convert(doc, url, html);
			imageUrls = this.extractImageUrls(content);
		} else {
			// 通用网页 → defuddle 全量解析 / Generic page → full defuddle
			const parsed = this.parseWithDefuddle(doc, url);
			content = parsed.content;
			imageUrls = parsed.imageUrls;
		}

		return this.saveNote({ ...metadata, content, imageUrls }, url, stsId);
	}

	/**
	 * 统一下游保存逻辑：sanitize → frontmatter → images → vault
	 * Unified downstream save: sanitize → frontmatter → images → vault
	 */
	private async saveNote(parsed: ParsedContent, sourceUrl: string, stsId: string): Promise<ProcessResult> {
		// 生成安全文件名 / Generate safe filename
		const safeTitle = this.sanitizeNoteTitle(parsed.title || 'Untitled');
		const notePath = normalizePath(`${this.settings.outputFolder}/${safeTitle}.md`);

		// 构建 frontmatter + Markdown body / Build frontmatter + Markdown body
		const frontmatter = this.buildFrontmatter(parsed, sourceUrl, stsId);
		let mdContent = frontmatter + '\n' + parsed.content;

		// 处理图片/附件 / Process images/attachments
		mdContent = await this.imageHandler.processContent(mdContent, safeTitle);

		// 确保输出目录存在 / Ensure output directory exists
		const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
		if (!dirExists) {
			await this.vault.createFolder(this.settings.outputFolder);
		}

		// 写入 .md 文件 / Write .md file
		await this.vault.create(notePath, mdContent);

		return { success: true, title: safeTitle };
	}

	/**
	 * 用 defuddle 提取元数据（title/author/published），不取 content
	 * Extract metadata only via defuddle (title/author/published), skip content
	 */
	private extractMetadata(doc: Document, url: string): Omit<ParsedContent, 'content' | 'imageUrls'> {
		const result = new Defuddle(doc, { url, markdown: false, useAsync: false }).parse();
		return {
			title: result.title || 'Untitled',
			author: result.author || '',
			authorUrl: result.authorUrl,
			published: result.published || '',
		};
	}

	/**
	 * defuddle 全量解析（通用网页路径）/ Full defuddle parse (generic page path)
	 */
	private parseWithDefuddle(doc: Document, url: string): ParsedContent {
		const result = new Defuddle(doc, { url, markdown: true, useAsync: false }).parse();
		const markdown = result.content ?? '';
		return {
			title: result.title || 'Untitled',
			author: result.author || '',
			authorUrl: result.authorUrl,
			published: result.published || '',
			content: markdown,
			imageUrls: this.extractImageUrls(markdown),
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
