/**
 * HTTP 请求工具函数：浏览器 UA 常量 + 标准请求头构建
 * HTTP utility: browser UA constant + standard request header construction
 *
 * 供 Node.js https 请求使用（HTML 获取、图片下载等），不适用于 Electron loadURL。
 * For Node.js https requests (HTML fetch, image download, etc.), not for Electron loadURL.
 */

/** Node.js 请求 / headless BrowserWindow / 图片下载共用的 Chrome UA */
/** Shared Chrome UA for Node.js fetch / headless BrowserWindow / image download */
export const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Safari/537.36';

/**
 * 构建标准 HTTP 请求头，供 Node.js https 请求使用。
 * Build standard HTTP headers for Node.js https requests.
 *
 * 现代浏览器必发 Sec-Fetch-* 系列头，缺失会被部分站点识别为非浏览器请求。
 * Modern browsers always send Sec-Fetch-* headers; missing them can be detected as non-browser.
 * Ref: Scrapling generate_headers() 完整浏览器 header 模拟 / full browser header emulation
 *
 * @param sourceUrl 来源页面 URL，用于生成 Referer（取 origin）。不传则不设 Referer。
 *                  Source page URL, used to generate Referer (origin only). No Referer if omitted.
 * @param accept    Accept 头值。用于推断 Sec-Fetch-Dest/Mode。不传则不设 Accept。
 *                  Accept header value. Used to infer Sec-Fetch-Dest/Mode. No Accept if omitted.
 */
export function buildHeaders(sourceUrl?: string, accept?: string): Record<string, string> {
	const headers: Record<string, string> = {
		'User-Agent': CHROME_UA,
		'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
	};

	if (accept) {
		headers['Accept'] = accept;
	}

	// Referer 取 origin，避免泄露完整路径 / origin-only to avoid leaking full path
	if (sourceUrl) {
		try {
			headers['Referer'] = new URL(sourceUrl).origin;
		} catch {
			/* 无效 URL 则跳过 Referer / skip Referer for invalid URL */
		}
	}

	// Sec-Fetch-* 系列：根据 Accept 类型推断资源用途
	// Sec-Fetch-* headers: infer resource destination from Accept type
	// Ref: Scrapling — 完整浏览器 headers 模拟 / full browser header emulation
	if (accept?.includes('text/html')) {
		// HTML 页面请求：等同于浏览器导航 / HTML page fetch: equivalent to browser navigation
		headers['Sec-Fetch-Dest'] = 'document';
		headers['Sec-Fetch-Mode'] = 'navigate';
		headers['Sec-Fetch-Site'] = 'cross-site';
		headers['Sec-Fetch-User'] = '?1';
	} else if (accept?.includes('image/')) {
		// 图片请求：等同于 <img> 标签加载 / Image fetch: equivalent to <img> tag loading
		headers['Sec-Fetch-Dest'] = 'image';
		headers['Sec-Fetch-Mode'] = 'no-cors';
		headers['Sec-Fetch-Site'] = 'cross-site';
	}

	return headers;
}
