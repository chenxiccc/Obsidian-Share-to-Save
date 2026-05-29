/**
 * 页面元数据提取器：title/author/published
 * Page metadata extractor: title/author/published
 *
 * 替代 defuddle 的元数据提取，专注于本项目需要的 4 个字段。
 * 参考 defuddle/src/metadata.ts 的提取策略，简化为实际需要的部分。
 * Replaces defuddle's metadata extraction, focused on the 4 fields this project needs.
 * Based on defuddle/src/metadata.ts extraction strategy, simplified to what's actually used.
 */

import type { Metadata } from './types';

// ─── 提取器 / Extractor ───────────────────────────────────────────────────────

export class MetadataExtractor {
	/**
	 * 从 Document 提取元数据
	 * Extract metadata from Document
	 */
	static extract(doc: Document): Metadata {
		const schema = MetadataExtractor.parseSchemaOrg(doc);

		return {
			title: MetadataExtractor.extractTitle(doc, schema),
			author: MetadataExtractor.extractAuthor(doc, schema),
			published: MetadataExtractor.extractPublished(doc, schema),
		};
	}

	// ── 标题 / Title ──────────────────────────────────────────────────────

	/**
	 * 提取标题，优先级：og:title → twitter:title → schema headline → <title> → h1
	 * Extract title, priority: og:title → twitter:title → schema headline → <title> → h1
	 *
	 * 会尝试剥离站点名后缀（如 "标题 | 站点名"）
	 * Attempts to strip site name suffix (e.g. "Title | Site Name")
	 */
	private static extractTitle(doc: Document, schema: Record<string, unknown>): string {
		const candidates: string[] = [
			MetadataExtractor.getMeta(doc, 'property', 'og:title'),
			MetadataExtractor.getMeta(doc, 'name', 'twitter:title'),
			MetadataExtractor.getSchemaString(schema, 'headline'),
			doc.querySelector('title')?.textContent?.trim() || '',
			doc.querySelector('h1')?.textContent?.trim() || '',
		].filter(Boolean);

		const rawTitle = candidates[0] || 'Untitled';
		const siteName = MetadataExtractor.getSiteName(doc, schema);

		return MetadataExtractor.stripSiteName(rawTitle, siteName);
	}

	/** 获取站点名 / Get site name */
	private static getSiteName(doc: Document, schema: Record<string, unknown>): string {
		return MetadataExtractor.getMeta(doc, 'property', 'og:site_name')
			|| MetadataExtractor.getMeta(doc, 'name', 'application-name')
			|| MetadataExtractor.getSchemaString(schema, 'publisher.name')
			|| '';
	}

	/**
	 * 尝试去除标题中的站点名后缀/前缀
	 * Try to strip site name suffix/prefix from title
	 *
	 * 常见格式： "标题 | 站点名" / "标题 - 站点名" / "站点名 | 标题"
	 * Common formats: "Title | Site" / "Title - Site" / "Site | Title"
	 */
	private static stripSiteName(rawTitle: string, siteName: string): string {
		if (!siteName || siteName.length < 2) return rawTitle;
		if (siteName.toLowerCase() === rawTitle.toLowerCase()) return rawTitle;

		const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const sep = '[|\\-–—·]';

		// 后缀： "标题 | 站点名" / Suffix: "Title | Site"
		const suffixRe = new RegExp(`\\s*${sep}\\s*${escaped}\\s*$`, 'i');
		if (suffixRe.test(rawTitle)) {
			return rawTitle.replace(suffixRe, '').trim();
		}

		// 前缀： "站点名 | 标题" / Prefix: "Site | Title"
		const prefixRe = new RegExp(`^\\s*${escaped}\\s*${sep}\\s*`, 'i');
		if (prefixRe.test(rawTitle)) {
			return rawTitle.replace(prefixRe, '').trim();
		}

		return rawTitle;
	}

	// ── 作者 / Author ─────────────────────────────────────────────────────

	/**
	 * 提取作者，优先级：meta author → article:author → schema author → DOM
	 * Extract author, priority: meta author → article:author → schema author → DOM
	 */
	private static extractAuthor(doc: Document, schema: Record<string, unknown>): string {
		// Meta 标签 / Meta tags
		const metaAuthor = MetadataExtractor.getMeta(doc, 'name', 'author');
		if (metaAuthor) return metaAuthor;

		const articleAuthor = MetadataExtractor.getMeta(doc, 'property', 'article:author');
		// article:author 可能是 URL，跳过 / May be URL, skip
		if (articleAuthor && !/^https?:\/\//i.test(articleAuthor)) return articleAuthor;

		// Schema.org / Schema.org
		const schemaAuthor = MetadataExtractor.getSchemaString(schema, 'author.name');
		if (schemaAuthor) return schemaAuthor;

		// DOM: rel="author" 链接 / DOM: rel="author" links
		const relAuthor = doc.querySelector('a[rel="author"]');
		if (relAuthor) {
			const text = (relAuthor.textContent || '').trim();
			if (text && text.length < 100) return text;
		}

		return '';
	}

	// ── 发布日期 / Published Date ─────────────────────────────────────────

	/**
	 * 提取发布日期，优先级：article:published_time → schema datePublished → <time>
	 * Extract published date, priority: article:published_time → schema datePublished → <time>
	 */
	private static extractPublished(doc: Document, schema: Record<string, unknown>): string {
		// Meta 标签 / Meta tags
		const publishedMeta = MetadataExtractor.getMeta(doc, 'property', 'article:published_time')
			|| MetadataExtractor.getMeta(doc, 'name', 'publishDate')
			|| MetadataExtractor.getMeta(doc, 'name', 'sailthru.date');
		if (publishedMeta) return publishedMeta;

		// Schema.org / Schema.org
		const schemaDate = MetadataExtractor.getSchemaString(schema, 'datePublished');
		if (schemaDate) return schemaDate;

		// DOM: <time datetime> / DOM: <time datetime>
		const timeEl = doc.querySelector('time[datetime]');
		if (timeEl) {
			const dt = timeEl.getAttribute('datetime');
			if (dt) return dt;
		}

		// DOM: <abbr itemprop="datePublished"> / DOM: <abbr itemprop="datePublished">
		const abbr = doc.querySelector('abbr[itemprop="datePublished"]');
		if (abbr) {
			const title = abbr.getAttribute('title');
			if (title) return title;
		}

		return '';
	}

	// ── 工具方法 / Utility Methods ───────────────────────────────────────

	/** 读取 <meta> 标签内容 / Read <meta> tag content */
	private static getMeta(doc: Document, attr: string, value: string): string {
		const el = doc.querySelector(`meta[${attr}="${value}"]`);
		return el?.getAttribute('content')?.trim() || '';
	}

	/** 从解析后的 schema.org JSON-LD 读取字符串字段 / Read string field from parsed schema.org JSON-LD */
	private static getSchemaString(schema: Record<string, unknown>, path: string): string {
		const keys = path.split('.');
		let current: unknown = schema;
		for (const key of keys) {
			if (current && typeof current === 'object') {
				current = (current as Record<string, unknown>)[key];
			} else {
				return '';
			}
		}
		return typeof current === 'string' ? current : '';
	}

	/**
	 * 解析页面中的 schema.org JSON-LD
	 * Parse schema.org JSON-LD from page
	 */
	private static parseSchemaOrg(doc: Document): Record<string, unknown> {
		const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
		for (const script of scripts) {
			try {
				const data = JSON.parse(script.textContent || '');
				// 查找 Article/WebPage/BlogPosting 等类型
				// Look for Article/WebPage/BlogPosting types
				const graph = data?.['@graph'];
				if (Array.isArray(graph)) {
					for (const item of graph) {
						if (MetadataExtractor.isContentSchema(item)) return item;
					}
				}
				if (MetadataExtractor.isContentSchema(data)) return data;
			} catch {
				// JSON 解析失败，跳过 / JSON parse failed, skip
			}
		}
		return {};
	}

	/** 判断是否为内容相关的 schema.org 类型 / Check if content-related schema.org type */
	private static isContentSchema(data: unknown): data is Record<string, unknown> {
		if (!data || typeof data !== 'object') return false;
		const d = data as Record<string, unknown>;
		const type = String(d['@type'] || '');
		return /Article|WebPage|BlogPosting|NewsArticle|Blog|CreativeWork/i.test(type);
	}
}
