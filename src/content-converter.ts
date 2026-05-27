/**
 * 分平台内容转换器：HTML → Markdown
 * Platform-specific content converter: HTML → Markdown
 *
 * defuddle 负责元数据提取（title/author/published），
 * 转换器负责 HTML 内容 → Markdown（含图片在原文位置）。
 *
 * defuddle handles metadata extraction (title/author/published),
 * converters handle HTML content → Markdown (with images in place).
 */

import TurndownService from 'turndown';

// ─── 接口 / Interface ────────────────────────────────────────────────────────

export interface ContentConverter {
	/** 匹配此转换器的域名模式 / Domain pattern this converter handles */
	readonly domainPattern: RegExp;
	/** 内容容器 CSS 选择器 / Content container CSS selector */
	readonly contentSelector: string;
	/** HTML Document → Markdown / Convert HTML Document to Markdown */
	convert(doc: Document, url: string): string;
}

// ─── 微信转换器 / WeChat Converter ──────────────────────────────────────────

class WeChatConverter implements ContentConverter {
	readonly domainPattern = /mp\.weixin\.qq\.com/;
	readonly contentSelector = '#js_content';

	convert(doc: Document, _url: string): string {
		// 1. 取 #js_content 元素 / Get #js_content element
		const el = doc.querySelector(this.contentSelector);
		if (!el) return '';

		// 2. 克隆并修复图片：data-src → src（参考 all-in-obs cleanContentHtml）
		// Clone and fix images: data-src → src
		const clone = el.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('img').forEach(img => {
			const dataSrc = img.getAttribute('data-src');
			if (dataSrc && !img.src) {
				img.setAttribute('src', dataSrc);
			}
		});

		// 3. 构建最小化 HTML / Build minimal HTML
		const miniHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${clone.innerHTML}</body></html>`;

		// 4. Turndown 转换 / Convert with Turndown
		return this.getTurndown().turndown(miniHtml);
	}

	private turndownInstance: TurndownService | null = null;

	private getTurndown(): TurndownService {
		if (this.turndownInstance) return this.turndownInstance;

		const td = new TurndownService({
			headingStyle: 'atx',
			codeBlockStyle: 'fenced',
			emDelimiter: '_',
			bulletListMarker: '-',
		});

		// 图片规则 / Image rule（优先取 data-src，回退 src）
		td.addRule('wechatImage', {
			filter: 'img',
			replacement: (_content: string, node: Node) => {
				const el = node as HTMLElement;
				const rawUrl = el.getAttribute('data-src')
					|| el.getAttribute('src')
					|| '';
				if (!rawUrl || !/^https?:\/\//.test(rawUrl)) return '';
				const alt = (el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() || 'Image';
				return `![${alt}](${rawUrl})`;
			},
		});

		// SVG 包裹图片：提取内部 <img> 再移除 SVG 容器
		// WeChat ezDrop 格式: <svg><foreignObject><img src="..."></foreignObject></svg>
		// Turndown 默认不进入 foreignObject，需在移除 SVG 前取出 img
		td.addRule('svgImage', {
			filter: (node: HTMLElement) => node.nodeName.toLowerCase() === 'svg',
			replacement: (_content: string, node: Node) => {
				const svg = node as HTMLElement;
				const imgs = svg.querySelectorAll('img');
				const parts: string[] = [];
				imgs.forEach(img => {
					const rawUrl = img.getAttribute('data-src')
						|| img.getAttribute('src')
						|| '';
					if (rawUrl && /^https?:\/\//.test(rawUrl)) {
						const alt = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() || 'Image';
						parts.push(`![${alt}](${rawUrl})`);
					}
				});
				return parts.join('\n');
			},
		});

		// 移除 style/script/noscript / Remove style/script/noscript
		td.addRule('removeStyleTags', {
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

/**
 * 根据 URL 查找匹配的内容转换器（无匹配时返回 null）
 * Find matching content converter for a URL (null if no match)
 */
export function findConverter(url: string): ContentConverter | null {
	return converters.find(c => c.domainPattern.test(url)) ?? null;
}
