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
	 * 处理单个 URL：headless BrowserWindow 获取渲染 HTML → defuddle 解析 → 保存 .md
	 * Process a single URL: headless BrowserWindow → defuddle parse → save .md
	 *
	 * 图片由 defuddle 在原文位置提取。Headless BrowserWindow 内嵌真实 Chromium，
	 * WeChat 返回的 HTML 中 img.src 直接是真实 URL，无需 data-src→src 转换。
	 *
	 * Images extracted by defuddle in their original positions. Headless BrowserWindow
	 * uses real Chromium; WeChat returns HTML with img.src as real URLs.
	 */
	async processUrl(url: string, stsId: string): Promise<ProcessResult> {
		// 剥离微信追踪参数 / Strip WeChat tracking params
		const cleanUrl = Downloader.stripWeChatTrackingParams(url);

		// headless BrowserWindow 获取渲染 HTML / Get rendered HTML via headless BrowserWindow
		const html = await this.headlessExtractor.extractRenderedHtml(cleanUrl);
		if (!html) {
			return { success: false, error: '无法获取页面内容 / Failed to fetch page content' };
		}

		// DOMParser 解析 / Parse with DOMParser
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');

		// 元数据：defuddle 统一提取 / Metadata: always from defuddle
		const metadata = this.extractMetadata(doc, cleanUrl);

		// 内容：分平台转换 / Content: platform-specific conversion
		const converter = findConverter(cleanUrl);
		let content: string;
		let imageUrls: string[];

		if (converter) {
			// 有平台转换器 → Turndown 转换 / Has converter → Turndown
			content = converter.convert(doc, cleanUrl);
			imageUrls = this.extractImageUrls(content);
		} else {
			// 通用网页 → defuddle 全量解析 / Generic page → full defuddle
			const parsed = this.parseWithDefuddle(doc, cleanUrl);
			content = parsed.content;
			imageUrls = parsed.imageUrls;
		}

		// 生成安全文件名 / Generate safe filename
		const safeTitle = this.sanitizeNoteTitle(metadata.title || 'Untitled');
		const notePath = normalizePath(`${this.settings.outputFolder}/${safeTitle}.md`);

		// 构建 frontmatter + Markdown body / Build frontmatter + Markdown body
		const frontmatter = this.buildFrontmatter(
			{ ...metadata, content, imageUrls },
			url,
			stsId,
		);
		let mdContent = frontmatter + '\n' + content;

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
