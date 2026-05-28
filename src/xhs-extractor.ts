/**
 * 小红书 HTTP 层：URL 检测 + Node.js https 页面获取
 * Xiaohongshu HTTP layer: URL detection + Node.js https page fetch
 *
 * 仅桌面端可用（依赖 Node.js require('https')）
 * Desktop only (depends on Node.js require('https'))
 *
 * 参考 all-in-obs XhsResolver + TECHNICAL-NOTES.md 的 Referer 结论
 * Based on all-in-obs XhsResolver + TECHNICAL-NOTES.md Referer findings
 */

/** Chrome UA — 与 all-in-obs 一致 / Chrome UA — consistent with all-in-obs */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 最大重定向次数 / Maximum redirect hops */
const MAX_REDIRECTS = 5;

/** 请求超时（毫秒）/ Request timeout (ms) */
const REQUEST_TIMEOUT_MS = 30_000;

// ─── URL 检测 / URL Detection ──────────────────────────────────────────────────

/**
 * 检测是否为小红书 URL（短链接或标准链接）
 * Check if URL is a Xiaohongshu URL (short link or standard link)
 */
export function isXiaohongshuUrl(url: string): boolean {
	return /xiaohongshu\.com|xhslink\.com/i.test(url);
}

// ─── HTTP 获取 / HTTP Fetch ────────────────────────────────────────────────────

/** fetchXhsHtml 返回结果 / Return type of fetchXhsHtml */
export interface XhsFetchResult {
	/** 页面 HTML / Page HTML */
	html: string;
	/** 规范 URL（从 og:url 提取，含 xsec_token）/ Canonical URL (from og:url, includes xsec_token) */
	canonicalUrl: string;
}

/**
 * 通过 Node.js https 获取小红书页面 HTML，手动跟踪重定向
 * Fetch Xiaohongshu page HTML via Node.js https, manually follow redirects
 *
 * 参考 image-handler.ts nodeHttpsGetBuffer 的重定向处理
 * Based on image-handler.ts nodeHttpsGetBuffer redirect handling
 *
 * @returns { html, canonicalUrl } 或 null（获取失败时）
 */
export async function fetchXhsHtml(url: string): Promise<XhsFetchResult | null> {
	try {
		return await doFetch(url, 0);
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('Share to Save: XHS 页面获取失败 / XHS page fetch failed:', err);
		return null;
	}
}

/**
 * 递归获取 HTML，跟踪重定向（最多 MAX_REDIRECTS 跳）
 * Recursively fetch HTML, following redirects (max MAX_REDIRECTS hops)
 */
function doFetch(requestUrl: string, redirectCount: number): Promise<XhsFetchResult | null> {
	if (redirectCount >= MAX_REDIRECTS) {
		return Promise.resolve(null);
	}

	const protocol = new URL(requestUrl).protocol === 'http:' ? 'http' : 'https';
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mod = require(protocol) as typeof import('https');

	return new Promise<XhsFetchResult | null>((resolve) => {
		const req = mod.get(requestUrl, {
			headers: {
				'User-Agent': CHROME_UA,
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Referer': 'https://www.xiaohongshu.com/',
			},
		}, (res) => {
			// 处理重定向 / Handle redirect
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				const redirectUrl = new URL(res.headers.location, requestUrl).toString();
				// 消费响应体以防止内存泄漏 / Consume response body to prevent memory leak
				res.resume();
				doFetch(redirectUrl, redirectCount + 1).then(resolve);
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
				const html = Buffer.concat(chunks).toString('utf-8');
				const canonicalUrl = extractCanonicalUrl(html) || requestUrl;
				resolve({ html, canonicalUrl });
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

// ─── Canonical URL 提取 / Canonical URL Extraction ─────────────────────────────

/**
 * 从 HTML 中提取 canonical URL（og:url meta 标签）
 * Extract canonical URL from HTML (og:url meta tag)
 */
function extractCanonicalUrl(html: string): string | null {
	const match = html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]*)"/i);
	return match?.[1] ?? null;
}
