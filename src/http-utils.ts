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
 * @param sourceUrl 来源页面 URL，用于生成 Referer（取 origin）。不传则不设 Referer。
 *                  Source page URL, used to generate Referer (origin only). No Referer if omitted.
 * @param accept    Accept 头值。不传则不设 Accept。
 *                  Accept header value. No Accept if omitted.
 */
export function buildHeaders(sourceUrl?: string, accept?: string): Record<string, string> {
	const headers: Record<string, string> = {
		'User-Agent': CHROME_UA,
		'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
	};
	if (accept) {
		headers['Accept'] = accept;
	}
	if (sourceUrl) {
		try {
			headers['Referer'] = new URL(sourceUrl).origin;
		} catch {
			/* 无效 URL 则跳过 Referer / skip Referer for invalid URL */
		}
	}
	return headers;
}
