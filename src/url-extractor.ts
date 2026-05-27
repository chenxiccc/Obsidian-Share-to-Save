/**
 * URL 提取器：从任意分享文本中提取 HTTP/HTTPS URL
 * URL Extractor: extract HTTP/HTTPS URLs from arbitrary share text
 *
 * V1: 仅提取第一个 URL / V1: only extract first URL
 */

/**
 * 通用的 URL 匹配正则（宽松模式，匹配 http/https 开头的 URL）
 * Generic URL matching regex (loose mode, matches URLs starting with http/https)
 */
const URL_REGEX = /(https?:\/\/[^\s,，。;；!！"')\]）>}　、。！，；：]+)/i;

/**
 * 尾部清理正则：移除 URL 末尾不应有的标点符号
 * Trailing cleanup regex: remove trailing punctuation that shouldn't be part of URL
 */
const TRAILING_PUNCTUATION = /[_*.,;!?'")\]）>】》]+$/;

/**
 * 从任意分享文本中提取第一个 HTTP/HTTPS URL
 * Extract first HTTP/HTTPS URL from arbitrary share text
 *
 * 支持的格式 / Supported formats:
 * - 纯 URL / Pure URL
 * - "文本 http://example.com 更多文本" — 混合文本（小红书分享格式等）
 * - 多行文本 — 仅提取第一个 URL
 *
 * @param text 分享文本 / Share text
 * @returns 提取到的 URL，或 null / Extracted URL, or null
 */
export function extractUrl(text: string): string | null {
	if (!text || !text.trim()) {
		return null;
	}

	const match = text.match(URL_REGEX);
	if (!match || !match[1]) {
		return null;
	}

	let url = match[1].trim();

	// 清理尾部标点 / Clean trailing punctuation
	url = url.replace(TRAILING_PUNCTUATION, '');

	// 验证 URL 长度合理性 / Validate reasonable URL length
	if (url.length < 10) {
		return null;
	}

	return url;
}

/**
 * 验证字符串是否为合法的 HTTP/HTTPS URL
 * Validate whether a string is a valid HTTP/HTTPS URL
 *
 * @param url URL 字符串
 * @returns 是否为合法 URL
 */
export function isValidUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}
