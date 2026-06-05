/**
 * 分平台内容转换器：HTML → Markdown
 * Platform-specific content converter: HTML → Markdown
 *
 * MetadataExtractor 负责元数据提取，转换器通过 metadataPatch 可修正。
 * 转换器负责 HTML 内容 → Markdown（含图片提取、代码块处理 + 补充提取）。
 */

import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import Defuddle from 'defuddle/full';
import type { Metadata } from './types';
import { escapeObsidianTags, escapeLinkDestination, ANGLT, ANGGT } from './text-utils';

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

const SYSTEM_IMG = ['pic_blank.gif', 'res.wx.qq.com/mmbizappmsg'];

// ─── 微信转换器 / WeChat Converter ──────────────────────────────────────────

class WeChatConverter implements ContentConverter {
	readonly domainPattern = /mp\.weixin\.qq\.com/;

	convert(doc: Document, _url: string, _rawHtml?: string): ConvertResult {
		const parts: string[] = [];

		// 区域 1: #js_content（标准图文 + 图片分享页的文字描述）
		// Area 1: #js_content (standard article + image detail page text)
		const jsContent = doc.getElementById('js_content');
		if (jsContent && (jsContent.textContent?.trim().length || 0) > 0) {
			const cleaned = this.buildCleanHtml(jsContent);
			const md = this.getTurndown().turndown(cleaned);
			if (md.trim()) parts.push(md);
		}

		// 区域 2: .img_swiper_area（图片分享页可见 swiper 区域，在 #js_content 外面，图片放文章结尾）
		// Area 2: .img_swiper_area (visible swiper for image share pages, outside #js_content, images at end)
		const imgSwiperArea = doc.querySelector('.img_swiper_area');
		if (imgSwiperArea && imgSwiperArea.querySelectorAll('img').length >= 2) {
			const cleaned = this.buildCleanHtml(imgSwiperArea as HTMLElement);
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
		const supplement = this.supplementImages(doc, markdown);
		if (supplement) {
			markdown = markdown.trimEnd() + '\n' + supplement;
		}
		markdown = this.cleanWhitespace(markdown);

		// 公众号名：MetadataExtractor 的 meta[name="author"] 在部分公众号文章为空，
		// .wx_follow_nickname 是微信渲染后 DOM 里最可靠的公众号名来源。
		// Account name: meta[name="author"] is absent in some WeChat articles;
		// .wx_follow_nickname is the most reliable source in the rendered DOM.
		const metadataPatch: Partial<Metadata> = {};
		const nickname = doc.querySelector('.wx_follow_nickname')?.textContent?.trim()
			|| doc.querySelector('#js_name')?.textContent?.trim();
		if (nickname) {
			metadataPatch.author = nickname;
		}

		return {
			markdown,
			metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
		};
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
			.trimEnd();  // 开头由 turndown postProcess() 已处理
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

	/** 克隆容器、data-src→src（含 Swiper 父级提升）、移除微信 UI、图片去重 → 构建最小 HTML */
	private buildCleanHtml(el: HTMLElement): string {
		const clone = el.cloneNode(true) as HTMLElement;

		// 1. <img data-src> → <img src> / Promote data-src on img elements
		clone.querySelectorAll('img').forEach(img => {
			const ds = img.getAttribute('data-src');
			const currentSrc = img.getAttribute('src') || '';
			if (ds && (!currentSrc || currentSrc.startsWith('data:') || currentSrc.includes('pic_blank'))) {
				img.setAttribute('src', ds);
			}
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

		// 移除微信 UI 元素（赞赏弹窗、底部导航、Swiper UI 等）
		// Remove WeChat UI elements (donation dialog, bottom nav, Swiper UI, etc.)
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
			// Swiper 占位符和 UI 元素 / Swiper placeholder and UI elements
			'.share_media_swiper_placeholder',  // hidden 占位符（含 page counter "1/15" 文本）
			'.swiper_indicator_wrp',             // dot 指示器 + counter 文本
			'.swiper_indicator_wrp_pc',          // PC 端 dot 指示器
			'.right-bottom-area',                // counter "1/15" 文字
		];
		uiSelectors.forEach(sel => {
			try { clone.querySelectorAll(sel).forEach(n => n.remove()); } catch { /* skip */ }
		});

		// 3. 代码块处理：多 <code> 合并 + data-lang 提取 + span/<br> 清理 + code-snippet__fix 行号移除
		//    Code block processing: merge multi <code> + extract data-lang + clean span/<br> + remove line numbers
		// a) code-snippet__fix 老格式：移除行号 <ul>，解包 <section> / Old format: remove line number <ul>, unwrap <section>
		clone.querySelectorAll('.code-snippet__fix').forEach(section => {
			section.querySelectorAll('.code-snippet__line-index').forEach(el => el.remove());
			const p = section.parentNode;
			if (p) {
				while (section.firstChild) p.insertBefore(section.firstChild, section);
				section.remove();
			}
		});
		// b) <pre> 内多 <code> 合并为单 <code> + data-lang 转 class / Merge multi <code> into single <code> + data-lang to class
		clone.querySelectorAll('pre').forEach(pre => {
			const codeEls = Array.from(pre.querySelectorAll(':scope > code'));
			if (codeEls.length > 1) {
				const lines = codeEls.map(c => c.textContent || '');
				const lang = pre.getAttribute('data-lang') || '';
				pre.innerHTML = '';
				const newCode = document.createElement('code');
				if (lang) newCode.className = `language-${lang}`;
				newCode.textContent = lines.join('\n');
				pre.appendChild(newCode);
			} else if (codeEls.length === 1 && pre.getAttribute('data-lang')) {
				(codeEls[0] as Element).classList.add(`language-${pre.getAttribute('data-lang')}`);
			}
			// c) 解包所有 <span> 标签（保留子节点，移除语法高亮标签） / Unwrap all <span> (keep children, remove syntax highlight tags)
			pre.querySelectorAll('span').forEach(span => {
				const sp = span.parentNode;
				if (sp) {
					while (span.firstChild) sp.insertBefore(span.firstChild, span);
					span.remove();
				}
			});
			// d) <br> → 换行符 / <br> → newline
			pre.querySelectorAll('br').forEach(br => {
				br.replaceWith(document.createTextNode('\n'));
			});
		});
		// 4. 图片去重：按 URL pathname 去重，消除 Swiper 循环复制图
		//    Image dedup: deduplicate by URL pathname to eliminate Swiper loop duplicates
		const seenPathnames = new Set<string>();
		clone.querySelectorAll('img').forEach(img => {
			const url = img.getAttribute('src') || '';
			if (!url || !/^https?:\/\//.test(url)) return;
			try {
				const p = new URL(url);
				const key = p.hostname.endsWith('.qpic.cn') ? p.origin + p.pathname : url;
				if (seenPathnames.has(key)) {
					img.remove();
				} else {
					seenPathnames.add(key);
				}
			} catch { /* keep image if URL parse fails */ }
		});

		// 5. 合并微信列表项：<section>• </section><section>正文</section> → 单行 "• 正文"
		//    Merge WeChat list items: inline marker <section> + content <section> → single element
		//    微信编辑器使用 flexbox section 模拟列表，而非标准 <ul>/<li>。
		//    Turndown 无法识别这种伪列表结构，会将 marker 和内容各转为独立段落。
		//    WeChat editor uses flexbox sections to simulate lists instead of <ul>/<li>.
		//    Turndown doesn't recognize this pseudo-list structure, producing separate paragraphs.
		const MARKER_PATTERN = /^(?:[•●○]|\d+[.、])\s*$/;
		clone.querySelectorAll('section').forEach(outerSection => {
			const children = Array.from(outerSection.children);
			if (children.length < 2) return;

			const firstChild = children[0] as HTMLElement;
			const markerText = (firstChild.textContent || '').trim();
			if (!MARKER_PATTERN.test(markerText)) return;

			// 将 marker 文本前置到第二个子元素内容开头
			// Prepend marker text to the second child's content
			const secondChild = children[1] as HTMLElement;
			// 保留 secondChild 的内部结构（可能有 <strong>, <code> 等），只在前加文本节点
			// Preserve secondChild's inner structure, just prepend a text node
			const textNode = document.createTextNode(markerText + ' ');
			secondChild.insertBefore(textNode, secondChild.firstChild);

			// 移除空的 marker 元素
			// Remove the now-empty marker element
			firstChild.remove();
		});

		return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${clone.innerHTML}</body></html>`;
	}

	// ── 图片补充 ──────────────────────────────────────────────────────────

	/**
	 * 全页扫描补充 Turndown 遗漏的图片
	 * Scan full page to supplement images missed by Turndown
	 *
	 * 过滤策略（按顺序）/ Filter strategy (in order):
	 * 1. 域名过滤：只保留 mmbiz.qpic.cn 图片（不依赖 URL 参数如 from=appmsg）
	 *    Domain filter: only mmbiz.qpic.cn images (no URL parameter dependency)
	 * 2. 系统图排除：pic_blank.gif、res.wx.qq.com/mmbizappmsg
	 *    System image exclusion
	 * 3. 推荐链接排除：<a> 内图片视为推荐缩略图
	 *    Thumbnail exclusion: images inside <a> are recommendation thumbnails
	 * 4. 头像排除：.wx_follow_avatar、.jump_author_avatar_con 内图片
	 *    Avatar exclusion: images inside avatar containers
	 * 5. 容器边界过滤（核心门槛）：只补充 .img_swiper_area 或 #js_content 内图片
	 *    Container boundary filter (core gate): only images inside processed containers
	 * 6. seen 预填充：收集已处理容器内图片 URL pathname 加入 seen，防 swiper 循环复制
	 *    Seen pre-fill: collect URLs from processed containers to prevent swiper loop dupes
	 * - data-src 优先（懒加载），回退 src / data-src preferred (lazy load), fallback src
	 * - 已有 Markdown 图片去重 / dedup against existing markdown images
	 */
	private supplementImages(doc: Document, existingMarkdown: string): string {
		const seen = new Set<string>();
		const parts: string[] = [];

		// 收集已有 Markdown 中的图片 URL / Collect existing image URLs
		const re = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(existingMarkdown)) !== null) {
			if (m[1]) seen.add(m[1]);
		}

		// URL 归一化（mmbiz.qpic.cn 去 query params 用于去重）
		// URL normalization (strip query params for mmbiz.qpic.cn dedup)
		const normalizeForDedup = (u: string): string => {
			try {
				const p = new URL(u);
				if (p.hostname.endsWith('.qpic.cn')) return p.origin + p.pathname;
			} catch { /* keep as-is */ }
			return u;
		};

		// seen 预填充：收集已处理容器内图片 URL，防 swiper 循环复制和 Turndown 重复
		// Seen pre-fill: collect image URLs from processed containers to prevent swiper loop dupes
		const prefillContainers = doc.querySelectorAll('.img_swiper_area img, #js_content img');
		for (const el of Array.from(prefillContainers)) {
			const img = el as HTMLImageElement;
			const url = img.getAttribute('data-src') || img.src;
			if (url && /^https?:\/\//.test(url)) {
				seen.add(normalizeForDedup(url));
			}
		}

		// DOM <img> 扫描（优先 data-src）/ DOM <img> scan: prefer data-src
		for (const img of Array.from(doc.querySelectorAll('img'))) {
			const url = img.getAttribute('data-src') || img.src;
			if (!url || !/^https?:\/\//.test(url)) continue;
			if (SYSTEM_IMG.some(f => url.includes(f))) continue;
			if (!url.includes('mmbiz.qpic.cn')) continue;
			// <a> 内 → 推荐缩略图 / Inside <a> → thumbnail
			if (img.closest('a')) continue;
			// .wx_follow_avatar / .jump_author_avatar_con 内 → 头像 / Inside avatar containers → avatar
			if (img.closest('.wx_follow_avatar, .jump_author_avatar_con')) continue;
			// 容器边界过滤（核心门槛）：只补充已处理容器内图片 / Container boundary (core gate): only processed containers
			if (!img.closest('.img_swiper_area, #js_content')) continue;
			const dedupKey = normalizeForDedup(url);
			if (seen.has(dedupKey)) continue;
			seen.add(dedupKey);
			const rawAlt = img.alt || '';
			const alt = rawAlt ? this.getTurndown().escape(rawAlt.replace(/\s+/g, ' ').trim()) : '';
			const escapedUrl = escapeLinkDestination(url);
			parts.push(`![${alt}](${escapedUrl})`);
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

		// GFM 扩展：表格、删除线、任务列表、围栏代码块高亮
		// GFM extensions: tables, strikethrough, task lists, fenced code blocks
		td.use(gfm);

		// 用内置 remove 替代自定义 removeTags 规则
		// Use built-in remove instead of custom rule
		td.remove(['style', 'script', 'noscript']);

		td.addRule('image', {
			filter: 'img',
			replacement: (_c: string, node: Node) => {
				const el = node as HTMLElement;
				const url = el.getAttribute('data-src') || el.getAttribute('src') || '';
				if (!url || !/^https?:\/\//.test(url)) return '';
				const rawAlt = (el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() || 'Image';
				const alt = td.escape(rawAlt);
				const escapedUrl = escapeLinkDestination(url);
				return `![${alt}](${escapedUrl})`;
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
						const rawAlt = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() || 'Image';
						const alt = td.escape(rawAlt);
						const escapedUrl = escapeLinkDestination(url);
						parts.push(`![${alt}](${escapedUrl})`);
					}
				});
				return parts.join('\n');
			},
		});

		// javascript:; 链接（微信话题标签等）：去掉链接，转义 # 防止 Obsidian 标签
		// javascript:; links (WeChat topic tags etc.): strip link, escape # to prevent Obsidian tags
		td.addRule('jsLink', {
			filter: (node: HTMLElement) =>
				node.nodeName.toLowerCase() === 'a' && (node.getAttribute('href') || '').startsWith('javascript:'),
			replacement: (content: string) => {
				// 转义 # 防止 Obsidian 识别为标签 / Escape # to prevent Obsidian tag recognition
				return escapeObsidianTags(content);
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
				const imgAlt = img ? (img.alt || '') : '';
				const rawText = (el.textContent || '').trim();
				const textOnly = rawText.replace(imgAlt, '').replace(/\s+/g, ' ').trim();
				if (href && /^https?:\/\//.test(href) && textOnly) {
					return `[${textOnly}](${href})`;
				}
				// 无文字说明 → 保留图片 / No text content → keep the image
				if (imgUrl && /^https?:\/\//.test(imgUrl)) {
					const rawAlt = imgAlt.replace(/\s+/g, ' ').trim() || 'Image';
					const alt = td.escape(rawAlt);
					const escapedImgUrl = escapeLinkDestination(imgUrl);
					return `![${alt}](${escapedImgUrl})`;
				}
				return '';
			},
		});

		this.turndownInstance = td;
		return td;
	}
}

// ─── 小红书类型 / XHS Types ──────────────────────────────────────────────────

interface XhsNoteImage {
	urlDefault?: string;
	url?: string;
}

interface XhsNoteUser {
	nickname?: string;
	userId?: string;
}

interface XhsNote {
	type?: string;
	title?: string;
	desc?: string | string[];
	imageList?: XhsNoteImage[];
	user?: XhsNoteUser;
}

interface XhsNoteDetailMap {
	[noteId: string]: { note?: XhsNote };
}

interface XhsInitialState {
	note?: {
		noteDetailMap?: XhsNoteDetailMap;
	};
}

// ─── 小红书转换器 / Xiaohongshu Converter ────────────────────────────────────

class XiaohongshuConverter implements ContentConverter {
	readonly domainPattern = /(?:www\.)?xiaohongshu\.com/;

	convert(doc: Document, url: string): ConvertResult {
		const state = this.findInitialStateScript(doc);
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
			text = escapeObsidianTags(text);
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
		//               author 从 __INITIAL_STATE__ 的 note.user 提取
		// Metadata patch: XHS title has " - 小红书" suffix, needs stripping
		//                  author extracted from note.user in __INITIAL_STATE__
		const metadataPatch: Partial<Metadata> = {};

		// 标题优先从 __INITIAL_STATE__ 取 note.title（真实标题，无后缀）
		// 为空时回退 <title> 标签，剥离 " - 小红书" 后缀
		// Title priority: note.title (real title, no suffix)
		// Fallback: <title> tag, strip " - 小红书" suffix
		if (note.title) {
			metadataPatch.title = note.title;
		} else {
			const rawTitle = doc.querySelector('title')?.textContent?.trim() || '';
			const cleanedTitle = rawTitle.replace(/\s*-\s*小红书\s*$/, '').trim();
			if (cleanedTitle && cleanedTitle !== rawTitle) {
				metadataPatch.title = cleanedTitle;
			}
		}

		// author 从 note.user 提取（MetadataExtractor 的 meta 标签在 XHS 为空）
		// author from note.user (MetadataExtractor meta tags are empty on XHS)
		const user = note.user;
		if (user?.nickname) {
			metadataPatch.author = user.nickname;
		}

		return {
			markdown: parts.join('\n'),
			metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
		};
	}

	/**
	 * 从 Document 的 <script> 标签中提取 window.__INITIAL_STATE__ JSON
	 * Extract window.__INITIAL_STATE__ JSON from Document's <script> tags
	 *
	 * 正则 + lastIndexOf("}") 截断，与 all-in-obs / xiaohongshu-importer / ob-Plugin 一致
	 * Regex + lastIndexOf("}") truncation, identical to all-in-obs / xiaohongshu-importer / ob-Plugin
	 */
	private findInitialStateScript(doc: Document): XhsInitialState | null {
		for (const script of Array.from(doc.querySelectorAll('script'))) {
			const text = script.textContent || '';
			if (!text.includes('window.__INITIAL_STATE__')) continue;
			const match = text.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*)$/);
			if (!match?.[1]) continue;
			const raw = match[1].trim();
			const result = this.parseInitialStateJson(raw);
			if (result) return result;
		}
		return null;
	}

	/**
	 * 从 __INITIAL_STATE__ 赋值表达式右半部分解析 JSON 对象
	 * Parse JSON object from __INITIAL_STATE__ assignment RHS
	 */
	private parseInitialStateJson(jsonStr: string): XhsInitialState | null {
		try {
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
			return JSON.parse(cleaned) as XhsInitialState;
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

// ─── Obsidian Publish 转换器 / Obsidian Publish Converter ──────────────────────

/**
 * Obsidian Publish 页面转换器
 * Obsidian Publish page converter
 *
 * acquireHtml 已将原始 Markdown 嵌入合成 HTML 的 <script id="publish-markdown"> 中。
 * 直接从该元素取 textContent 返回，不经过 Turndown（内容已经是最终 Markdown）。
 * acquireHtml has embedded raw Markdown in <script id="publish-markdown"> of synthesized HTML.
 * Returns textContent directly, no Turndown needed (content is already final Markdown).
 */
class ObsidianPublishConverter implements ContentConverter {
	readonly domainPattern = /obsidian\.md/;

	convert(doc: Document, _url: string, _rawHtml?: string): ConvertResult {
		// 从合成 HTML 提取原始 Markdown / Extract raw Markdown from synthesized HTML
		const script = doc.getElementById('publish-markdown');
		if (script?.textContent?.trim()) {
			return { markdown: script.textContent.trim() };
		}
		// 降级：非合成 HTML（headless 渲染的正常页面），返回空让 DefuddleConverter 兜底
		// Fallback: not synthesized HTML (headless-rendered page), return empty for DefuddleConverter
		return { markdown: '' };
	}
}

// ─── 知乎转换器 / Zhihu Converter ─────────────────────────────────────────────

/**
 * 知乎专栏页面转换器
 * Zhihu zhuanlan article converter
 *
 * 预处理 rawHtml 修复三个问题：
 * 1. 剥离 <a.RichContent-EntityWord> 实体链接（zhida.zhihu.com 关键词链接）
 * 2. 保护 &lt; &gt; 防止 DOMParser 解码后 Turndown 输出原始 HTML 标签
 * 3. 单格 <th> 代码表 → <pre><code>
 * Three fixes via rawHtml preprocessing:
 * 1. Strip entity links (zhida.zhihu.com keyword links)
 * 2. Protect &lt; &gt; from being decoded and output as raw HTML tags
 * 3. Convert single-cell <th> code tables to <pre><code>
 */
class ZhihuConverter implements ContentConverter {
	readonly domainPattern = /zhuanlan\.zhihu\.com/;

	convert(doc: Document, url: string, _rawHtml?: string): ConvertResult {
		// 直接操作管线 doc（已过 protectAngleBrackets + normalizeBoldElements）
		this.stripEntityLinks(doc);
		this.normalizeCodeBlocks(doc);

		const result = new Defuddle(doc, { url, markdown: true, useAsync: false }).parse();
		return { markdown: result.content ?? '' };
	}

	/**
	 * 剥离 <a class="RichContent-EntityWord"> 实体链接，保留纯文本
	 * Strip zhida keyword entity links in DOM, keep plain text only
	 */
	private stripEntityLinks(doc: Document): void {
		doc.querySelectorAll('a.RichContent-EntityWord').forEach(el => {
			const text = el.textContent || '';
			el.replaceWith(doc.createTextNode(text));
		});
	}

	/**
	 * 规范化代码块：单格 <th> 代码表 → <pre><code>
	 * Normalize code blocks: single-cell <th> code table → <pre><code> in DOM
	 *
	 * Zhihu wraps code blocks in single-cell <table data-draft-type="table"><th>
	 * with <br> line breaks (not <pre><code>). Detect by code-like content
	 * and convert to standard <pre><code> format.
	 */
	private normalizeCodeBlocks(doc: Document): void {
		doc.querySelectorAll('table[data-draft-type="table"]').forEach(table => {
			// Only process single-cell <th> tables
			const cells = Array.from(table.querySelectorAll('th, td'))
				.filter(cell => cell.closest('table') === table);
			if (cells.length !== 1) return;

			const cell = cells[0] as Element;
			// Extract code text: <br> → newline, strip HTML, restore ANGLT → <
			const html = cell.innerHTML;
			const codeText = html
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<[^>]+>/g, '')
				// Pipeline protectAngleBrackets left ANGLT in text → restore for code
				.replace(new RegExp(ANGLT, 'g'), '<')
				.replace(new RegExp(ANGGT, 'g'), '>')
				.replace(/&amp;/g, '&');

			if (!this.isCodeLike(codeText)) return;
			if (!codeText.trim()) return;

			const pre = doc.createElement('pre');
			const code = doc.createElement('code');
			code.textContent = codeText;
			pre.appendChild(code);
			table.replaceWith(pre);
		});
	}

	/**
	 * 检测文本是否像代码
	 * Detect if text looks like code
	 */
	private isCodeLike(text: string): boolean {
		return /^\s*(?:from\s+|import\s+|def\s+|class\s+|print\s*\(|#\s|if\s+|for\s+|while\s+|\w+\s*=\s*)/m.test(text)
			|| (text.split('\n').length >= 3 && /[=){}[\]]/.test(text));
	}
}

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
	new ObsidianPublishConverter(),
	new ZhihuConverter(),
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
