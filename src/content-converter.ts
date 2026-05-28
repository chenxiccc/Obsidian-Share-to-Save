/**
 * 分平台内容转换器：HTML → Markdown
 * Platform-specific content converter: HTML → Markdown
 *
 * defuddle 负责元数据提取（title/author/published），
 * 转换器负责 HTML 内容 → Markdown（含图片在原文位置 + 补充提取）。
 */

import TurndownService from 'turndown';
import Defuddle from 'defuddle/full';
import type { Metadata } from './metadata-extractor';

// ─── 类型 / Types ──────────────────────────────────────────────────────────

/** 内容转换结果 / Content conversion result */
export interface ConvertResult {
	/** Markdown 正文 / Markdown body */
	markdown: string;
	/** 平台可修正 MetadataExtractor 提取的元数据 / Platform can patch metadata from MetadataExtractor */
	metadataPatch?: Partial<Metadata>;
}

// ─── 接口 / Interface ────────────────────────────────────────────────────────

export interface ContentConverter {
	readonly domainPattern: RegExp;
	/** @param rawHtml 原始 HTML 字符串（用于提取 <script> 内 JSON 等 DOM 无法表达的内容） */
	convert(doc: Document, url: string, rawHtml?: string): ConvertResult;
}

// ─── 微信常量 / WeChat constants ─────────────────────────────────────────────

/** 微信内容容器选择器（参考 ima-copilot-sync WECHAT_CONTENT_SELECTORS） */
const WECHAT_CONTAINERS = [
	'#js_content', '.rich_media_content', '.share_content_page',
	'#img_list', '#js_video_page_title', '#js_audio_title', '#audio_panel_area',
	'#js_text_title', '#js_novel_card', '#img-content', '.rich_media',
];

const SYSTEM_IMG = ['pic_blank.gif', 'res.wx.qq.com/mmbizappmsg'];

// ─── 微信转换器 / WeChat Converter ──────────────────────────────────────────

class WeChatConverter implements ContentConverter {
	readonly domainPattern = /mp\.weixin\.qq\.com/;

	convert(doc: Document, _url: string, _rawHtml?: string): ConvertResult {
		const parts: string[] = [];

		// 区域 1: #img_list（图片分享页 swiper 图片，在 #js_content 外面）
		// Area 1: #img_list (image detail page swiper, outside #js_content)
		const imgList = doc.getElementById('img_list');
		if (imgList && imgList.querySelectorAll('img').length >= 2) {
			const cleaned = this.buildCleanHtml(imgList);
			const md = this.getTurndown().turndown(cleaned);
			if (md.trim()) parts.push(md);
		}

		// 区域 2: #js_content（标准图文 + 图片分享页的文字描述）
		// Area 2: #js_content (standard article + image detail page text)
		const jsContent = doc.getElementById('js_content');
		if (jsContent && (jsContent.textContent?.trim().length || 0) > 0) {
			const cleaned = this.buildCleanHtml(jsContent);
			const md = this.getTurndown().turndown(cleaned);
			if (md.trim()) parts.push(md);
		}

		// 后备：都没找到 → 旧容器检测 / Fallback: neither found → old container detection
		if (parts.length === 0) {
			const container = this.detectContainer(doc);
			if (container) {
				const md = this.getTurndown().turndown(this.buildCleanHtml(container));
				if (md.trim()) parts.push(md);
			}
		}

		let markdown = parts.join('\n');
		// 全页补充图片（最终安全网）/ Full page supplement (final safety net)
		const outerHtml = doc.documentElement.outerHTML || '';
		const supplement = this.supplementImages(doc, outerHtml, markdown);
		if (supplement) {
			markdown = markdown.trimEnd() + '\n' + supplement;
		}
		markdown = this.cleanWhitespace(markdown);
		return { markdown };
	}

	/**
	 * 清理多余空行：去除纯空白行，合并连续空行
	 * Clean excess whitespace: remove whitespace-only lines, collapse consecutive blank lines
	 */
	private cleanWhitespace(md: string): string {
		return md
			.split('\n')
			.map(line => line.trim() ? line.trimEnd() : '')
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	// ── 容器检测 ──────────────────────────────────────────────────────────

	/**
	 * 检测微信文章内容容器（覆盖 7+ 种微信格式）
	 * Detect WeChat article content container (covers 7+ WeChat formats)
	 */
	private detectContainer(doc: Document): HTMLElement | null {
		// 标准图文 / Standard article（需足够文本，防止空壳 div）
		const js = doc.getElementById('js_content');
		if (js && (js.textContent?.trim().length || 0) > 50) return js;

		// 图片分享页 / Image share page
		const share = doc.querySelector('.share_content_page');
		if (share) {
			const t = share.textContent?.trim().length || 0;
			if (t > 30 || share.querySelectorAll('img').length >= 2) return share as HTMLElement;
		}

		// 富文本后备 / Rich media fallback
		for (const sel of ['.rich_media_content', '#img-content', '.rich_media']) {
			const el = doc.querySelector(sel);
			if (el && (el.textContent?.trim().length || 0) > 30) return el as HTMLElement;
		}

		return null;
	}

	/** 克隆容器、data-src→src（含 Swiper 父级提升）、移除微信 UI → 构建最小 HTML */
	private buildCleanHtml(el: HTMLElement): string {
		const clone = el.cloneNode(true) as HTMLElement;

		// 1. <img data-src> → <img src> / Promote data-src on img elements
		clone.querySelectorAll('img').forEach(img => {
			const ds = img.getAttribute('data-src');
			if (ds && !img.src) img.setAttribute('src', ds);
		});

		// 2. Swiper 懒加载：父级 <div data-src="真实URL"> → 子 <img src>
		//    Swiper lazy load: parent <div data-src> → child <img src>
		clone.querySelectorAll('[data-src]').forEach(el => {
			if (el.tagName === 'IMG') return;
			const ds = el.getAttribute('data-src');
			if (!ds) return;
			el.querySelectorAll('img').forEach(img => {
				if (!img.getAttribute('src') || img.src.includes('pic_blank')) {
					img.setAttribute('src', ds);
				}
			});
		});

		// 移除微信 UI 元素（赞赏弹窗、底部导航等）
		// Remove WeChat UI elements (donation dialog, bottom nav, etc.)
		const uiSelectors = [
			'.reward_area', '.reward_qrcode', '.reward_setting',
			'.profile_area', '.profile_inner',
			'.rich_media_area_extra', '.rich_media_meta_list',
			'.reward_area-normal', '.reward_user',
			'#js_pc_qr_code', '.qr_code_pc_outer',
			'[class*="reward"]', '[class*="赞赏"]',
			'#js_reward_area', '#js_bottom_ad',
			'.original_panel', '.global_vip_guide',
			'mp-common-profile', 'mp-common-mpaudio',
		];
		uiSelectors.forEach(sel => {
			try { clone.querySelectorAll(sel).forEach(n => n.remove()); } catch { /* skip */ }
		});

		return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${clone.innerHTML}</body></html>`;
	}

	// ── 图片补充 ──────────────────────────────────────────────────────────

	/**
	 * 全页扫描补充 Turndown 遗漏的图片
	 * Scan full page to supplement images missed by Turndown
	 *
	 * 参考 ima-copilot-sync extractWeChatImages
	 * - from=appmsg 是区分正文图和推荐缩略图的唯一特征
	 * - data-src 优先（懒加载），回退 src
	 * - 已有 Markdown 图片去重
	 */
	private supplementImages(doc: Document, rawHtml: string, existingMarkdown: string): string {
		const seen = new Set<string>();
		const parts: string[] = [];

		// 收集已有 Markdown 中的图片 URL / Collect existing image URLs
		const re = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(existingMarkdown)) !== null) {
			if (m[1]) seen.add(m[1]);
		}

		// DOM <img> 扫描（优先 data-src）/ DOM <img> scan: prefer data-src
		for (const img of Array.from(doc.querySelectorAll('img'))) {
			const url = img.getAttribute('data-src') || img.src;
			if (!url || !/^https?:\/\//.test(url)) continue;
			if (SYSTEM_IMG.some(f => url.includes(f))) continue;
			if (!url.includes('from=appmsg')) continue;
			// <a> 内 → 推荐缩略图 / Inside <a> → thumbnail
			if (img.closest('a')) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			parts.push(`![${(img as HTMLImageElement).alt || ''}](${url})`);
		}

		// 父级 [data-src] 扫描：Swiper 懒加载图片 URL 在 <div data-src> 上
		// Parent [data-src] scan: Swiper lazy image URLs on <div data-src>
		for (const el of Array.from(doc.querySelectorAll('[data-src]'))) {
			if (el.tagName === 'IMG') continue;
			const url = el.getAttribute('data-src') || '';
			if (!url || !/^https?:\/\//.test(url)) continue;
			if (!url.includes('from=appmsg')) continue;
			if (el.closest('a')) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			parts.push(`![](${url})`);
		}

		// cdn_url 正则：swiper 轮播隐藏图不在 DOM 中（参考 ima-copilot-sync 踩坑 #3/#8）
		// cdn_url regex: swiper hidden images not in DOM
		const cdnRe = /cdn_url\s*:\s*['"](https?:\/\/[^'"]*?)['"]/gi;
		let cm: RegExpExecArray | null;
		while ((cm = cdnRe.exec(rawHtml)) !== null) {
			const url = cm[1] as string;
			if (!seen.has(url)) {
				seen.add(url);
				parts.push(`![](${url})`);
			}
		}

		return parts.length > 0 ? parts.join('\n') + '\n' : '';
	}

	// ── Turndown ──────────────────────────────────────────────────────────

	private turndownInstance: TurndownService | null = null;

	private getTurndown(): TurndownService {
		if (this.turndownInstance) return this.turndownInstance;

		const td = new TurndownService({
			headingStyle: 'atx', codeBlockStyle: 'fenced',
			emDelimiter: '_', bulletListMarker: '-',
		});

		td.addRule('image', {
			filter: 'img',
			replacement: (_c: string, node: Node) => {
				const el = node as HTMLElement;
				const url = el.getAttribute('data-src') || el.getAttribute('src') || '';
				if (!url || !/^https?:\/\//.test(url)) return '';
				const alt = (el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() || 'Image';
				return `![${alt}](${url})`;
			},
		});

		// SVG 包裹图片（WeChat ezDrop）
		td.addRule('svgImage', {
			filter: (node: HTMLElement) => node.nodeName.toLowerCase() === 'svg',
			replacement: (_c: string, node: Node) => {
				const parts: string[] = [];
				(node as HTMLElement).querySelectorAll('img').forEach(img => {
					const url = img.getAttribute('data-src') || img.getAttribute('src') || '';
					if (url && /^https?:\/\//.test(url)) {
						const alt = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() || 'Image';
						parts.push(`![${alt}](${url})`);
					}
				});
				return parts.join('\n');
			},
		});

		// 带图片的链接：有文字 → 文字链接；无文字 → 保留图片（微信文章点击查看大图）
		// Linked images: has text → text link; no text → keep image (WeChat click-to-enlarge)
		td.addRule('linkedImage', {
			filter: (node: HTMLElement) =>
				node.nodeName.toLowerCase() === 'a' && node.querySelector('img') !== null,
			replacement: (_content: string, node: Node) => {
				const el = node as HTMLElement;
				const href = el.getAttribute('href') || '';
				const img = el.querySelector('img');
				const imgUrl = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
				const imgAlt = img ? ((img as HTMLImageElement).alt || '') : '';
				const rawText = (el.textContent || '').trim();
				const textOnly = rawText.replace(imgAlt, '').replace(/\s+/g, ' ').trim();
				if (href && /^https?:\/\//.test(href) && textOnly) {
					return `[${textOnly}](${href})`;
				}
				// 无文字说明 → 保留图片 / No text content → keep the image
				if (imgUrl && /^https?:\/\//.test(imgUrl)) {
					const alt = imgAlt.replace(/\s+/g, ' ').trim() || 'Image';
					return `![${alt}](${imgUrl})`;
				}
				return '';
			},
		});

		td.addRule('removeTags', {
			filter: ['style', 'script', 'noscript'],
			replacement: () => '',
		});

		this.turndownInstance = td;
		return td;
	}
}

// ─── 小红书转换器 / Xiaohongshu Converter ────────────────────────────────────

class XiaohongshuConverter implements ContentConverter {
	readonly domainPattern = /(?:www\.)?xiaohongshu\.com/;

	convert(doc: Document, url: string, rawHtml?: string): ConvertResult {
		// 使用原始 HTML（DOMParser 序列化后 <script> 内容可能被修改）
		// Use raw HTML (DOMParser serialization may modify <script> content)
		const html = rawHtml || doc.documentElement.outerHTML || '';
		const state = this.parseInitialState(html);
		if (!state) {
			return { markdown: this.fallbackExtract(doc) };
		}

		const noteDetailMap = state?.note?.noteDetailMap;
		if (!noteDetailMap) return { markdown: this.fallbackExtract(doc) };

		const noteId = Object.keys(noteDetailMap)[0];
		if (!noteId) return { markdown: this.fallbackExtract(doc) };
		const note = noteDetailMap[noteId]?.note;
		if (!note) return { markdown: this.fallbackExtract(doc) };

		const parts: string[] = [];

		// 视频笔记标记 / Video note indicator
		if (note.type === 'video') {
			parts.push('> [!NOTE] 视频笔记 / Video Note\n');
		}

		// 正文（转义 # 防止 Obsidian 标签误识别）
		// Content (escape # to prevent Obsidian tag misinterpretation)
		const desc = note.desc;
		if (desc) {
			let text = Array.isArray(desc) ? desc.join('\n') : String(desc);
			// 去除 XHS 话题标记 [话题]# / Remove XHS topic markers
			text = text.replace(/\[话题\]#?/g, '');
			// 转义行首和空格后的 #，避免被 Obsidian 识别为标签
			// Escape # at line start or after space to prevent Obsidian tag recognition
			text = text.replace(/(^|\s)#/g, '$1\\#');
			parts.push(text);
		}

		// 图片（从 __INITIAL_STATE__ 提取，defuddle 看不到）
		// Images (extracted from __INITIAL_STATE__, invisible to defuddle)
		const images = note.imageList;
		if (images && images.length > 0) {
			parts.push('');
			for (const img of images) {
				const imgUrl = img.urlDefault || img.url;
				if (imgUrl) {
					parts.push(`![](${imgUrl})`);
				}
			}
		}

		// 元数据修正：XHS 标题含 " - 小红书" 后缀需去除
		//               authorUrl 可能是相对路径需补全域名
		// Metadata patch: XHS title has " - 小红书" suffix, needs stripping
		//                  authorUrl may be relative, needs domain prepended
		const metadataPatch: Partial<Metadata> = {};

		// 从 <title> 提取的标题含 " - 小红书" 后缀，除去
		// Title from <title> has " - 小红书" suffix, strip it
		const rawTitle = doc.querySelector('title')?.textContent?.trim() || '';
		const cleanedTitle = rawTitle.replace(/\s*-\s*小红书\s*$/, '').trim();
		if (cleanedTitle && cleanedTitle !== rawTitle) {
			metadataPatch.title = cleanedTitle;
		}

		// authorUrl 补全域名 / Prepend domain to authorUrl
		const authorEl = doc.querySelector('meta[property="article:author"]');
		const authorUrl = authorEl?.getAttribute('content')?.trim();
		if (authorUrl && authorUrl.startsWith('/')) {
			metadataPatch.authorUrl = 'https://www.xiaohongshu.com' + authorUrl;
		}

		return {
			markdown: parts.join('\n'),
			metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
		};
	}

	/**
	 * 解析 window.__INITIAL_STATE__ JSON
	 * Parse window.__INITIAL_STATE__ JSON
	 *
	 * 正则 + lastIndexOf("}") 截断，与 all-in-obs / xiaohongshu-importer / ob-Plugin 一致
	 * Regex + lastIndexOf("}") truncation, identical to all-in-obs / xiaohongshu-importer / ob-Plugin
	 */
	private parseInitialState(html: string): any | null {
		const match = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/i);
		if (!match?.[1]) return null;
		try {
			let jsonStr = match[1].trim();
			// 去掉末尾分号 / Strip trailing semicolon
			jsonStr = jsonStr.replace(/;\s*$/, '');
			// 取最后一个 } 截断，去掉 JSON 后的多余 JS 代码
			// Truncate at last } to remove trailing JS code after JSON
			const lastBrace = jsonStr.lastIndexOf('}');
			if (lastBrace >= 0) {
				jsonStr = jsonStr.slice(0, lastBrace + 1);
			}
			// 替换 JSON 中非法的 JS 字面量 / Replace illegal JS literals in JSON
			const cleaned = jsonStr.replace(/undefined/g, 'null').replace(/\bNaN\b/g, 'null');
			return JSON.parse(cleaned);
		} catch {
			return null;
		}
	}

	/**
	 * DOM 降级提取：当 __INITIAL_STATE__ 解析失败时使用 #detail-desc 选择器
	 * DOM fallback extraction: use #detail-desc selector when __INITIAL_STATE__ parsing fails
	 */
	private fallbackExtract(doc: Document): string {
		const descEl = doc.querySelector('#detail-desc');
		return descEl?.textContent?.trim() || '';
	}
}

// ─── Defuddle 通用回退 / Defuddle Generic Fallback ───────────────────────────

/**
 * 无平台转换器匹配时，使用 defuddle 全量解析作为兜底
 * When no platform converter matches, use defuddle full parse as fallback
 */
class DefuddleConverter implements ContentConverter {
	readonly domainPattern = /.*/;

	convert(doc: Document, url: string, _rawHtml?: string): ConvertResult {
		const result = new Defuddle(doc, { url, markdown: true, useAsync: false }).parse();
		return { markdown: result.content ?? '' };
	}
}

// ─── 注册表 / Registry ───────────────────────────────────────────────────────

const converters: ContentConverter[] = [
	new WeChatConverter(),
	new XiaohongshuConverter(),
];

/** Defuddle 通用回退，始终在注册表末尾作为兜底 / Defuddle generic fallback, always at end of registry */
const defuddleFallback = new DefuddleConverter();

/**
 * 查找匹配的转换器，无匹配时返回 DefuddleConverter 兜底
 * Find matching converter, returns DefuddleConverter fallback when no match
 */
export function findConverter(url: string): ContentConverter {
	return converters.find(c => c.domainPattern.test(url)) ?? defuddleFallback;
}
