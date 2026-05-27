/**
 * 分平台内容转换器：HTML → Markdown
 * Platform-specific content converter: HTML → Markdown
 *
 * defuddle 负责元数据提取（title/author/published），
 * 转换器负责 HTML 内容 → Markdown（含图片在原文位置 + 补充提取）。
 */

import TurndownService from 'turndown';

// ─── 接口 / Interface ────────────────────────────────────────────────────────

export interface ContentConverter {
	readonly domainPattern: RegExp;
	convert(doc: Document, url: string): string;
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

	convert(doc: Document, _url: string): string {
		const container = this.detectContainer(doc);
		const containerHtml = container ? this.buildCleanHtml(container) : '';
		let markdown = containerHtml ? this.getTurndown().turndown(containerHtml) : '';

		// 全页补充图片（部分微信模板图片在容器之外）
		const supplement = this.supplementImages(doc, markdown);
		if (supplement) {
			markdown = markdown.trimEnd() + '\n' + supplement;
		}
		return markdown;
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

	/** 克隆容器、data-src→src、构建最小 HTML */
	private buildCleanHtml(el: HTMLElement): string {
		const clone = el.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('img').forEach(img => {
			const ds = img.getAttribute('data-src');
			if (ds && !img.src) img.setAttribute('src', ds);
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
	private supplementImages(doc: Document, existingMarkdown: string): string {
		const seen = new Set<string>();
		const parts: string[] = [];

		// 收集已有 Markdown 中的图片 URL / Collect existing image URLs
		const re = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(existingMarkdown)) !== null) {
			if (m[1]) seen.add(m[1]);
		}

		// DOM <img> 扫描（优先 data-src）
		for (const img of Array.from(doc.querySelectorAll('img'))) {
			const url = img.getAttribute('data-src') || img.src;
			if (!url || !/^https?:\/\//.test(url)) continue;
			if (SYSTEM_IMG.some(f => url.includes(f))) continue;
			if (!url.includes('from=appmsg')) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			parts.push(`![${(img as HTMLImageElement).alt || ''}](${url})`);
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

		td.addRule('removeTags', {
			filter: ['style', 'script', 'noscript'],
			replacement: () => '',
		});

		this.turndownInstance = td;
		return td;
	}
}

// ─── 注册表 / Registry ───────────────────────────────────────────────────────

const converters: ContentConverter[] = [
	new WeChatConverter(),
	// new XiaohongshuConverter(),  // 后续
];

export function findConverter(url: string): ContentConverter | null {
	return converters.find(c => c.domainPattern.test(url)) ?? null;
}
