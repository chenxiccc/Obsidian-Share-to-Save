/**
 * url-extractor.ts 测试 / Tests for url-extractor.ts
 *
 * Covers: extractUrl, extractUrls, isValidUrl
 */
import { describe, it, expect } from 'vitest';
import { extractUrl, extractUrls, isValidUrl } from '../src/url-extractor';

// ============================================================================
// extractUrl
// ============================================================================

describe('extractUrl', () => {
	it('extracts a pure URL', () => {
		expect(extractUrl('https://example.com')).toBe('https://example.com');
		expect(extractUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1');
	});

	it('extracts URL from mixed Chinese text', () => {
		expect(extractUrl('看看这个 https://example.com 有意思'))
			.toBe('https://example.com');
	});

	it('extracts first URL when multiple exist', () => {
		expect(extractUrl('https://first.com https://second.com'))
			.toBe('https://first.com');
	});

	it('strips trailing punctuation', () => {
		expect(extractUrl('https://example.com。')).toBe('https://example.com');
		expect(extractUrl('https://example.com，')).toBe('https://example.com');
		expect(extractUrl('https://example.com）')).toBe('https://example.com');
	});

	it('returns null for text without URL', () => {
		expect(extractUrl('just some text')).toBeNull();
		expect(extractUrl('没有链接')).toBeNull();
	});

	it('returns null for empty or whitespace input', () => {
		expect(extractUrl('')).toBeNull();
		expect(extractUrl('   ')).toBeNull();
	});

	it('returns null for URLs shorter than 10 characters', () => {
		expect(extractUrl('https://a')).toBeNull();
	});

	it('extracts URL from XHS-style share text', () => {
		const xhsText = '小红书分享：发现一个好东西 http://xhslink.com/abc123，快来看吧';
		expect(extractUrl(xhsText)).toBe('http://xhslink.com/abc123');
	});

	it('handles newlines in text', () => {
		expect(extractUrl('line1\nhttps://example.com\nline3'))
			.toBe('https://example.com');
	});
});

// ============================================================================
// extractUrls
// ============================================================================

describe('extractUrls', () => {
	it('extracts all unique URLs', () => {
		const result = extractUrls('https://a.com https://b.com');
		expect(result).toEqual(['https://a.com', 'https://b.com']);
	});

	it('deduplicates identical URLs', () => {
		const result = extractUrls('https://a.com https://a.com https://b.com');
		expect(result).toEqual(['https://a.com', 'https://b.com']);
	});

	it('preserves order of first occurrence', () => {
		const result = extractUrls('https://b.com https://a.com https://b.com');
		expect(result).toEqual(['https://b.com', 'https://a.com']);
	});

	it('extracts URLs from multiline text', () => {
		const result = extractUrls('https://a.com\nhttps://b.com\nnot a url\nhttps://c.com');
		expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
	});

	it('returns empty array for text without URLs', () => {
		expect(extractUrls('no urls here')).toEqual([]);
	});

	it('returns empty array for empty input', () => {
		expect(extractUrls('')).toEqual([]);
		expect(extractUrls('   ')).toEqual([]);
	});

	it('strips trailing punctuation from each URL', () => {
		const result = extractUrls('https://a.com。 https://b.com）');
		expect(result).toEqual(['https://a.com', 'https://b.com']);
	});

	it('handles mixed Chinese and URLs', () => {
		const result = extractUrls('第一个 https://a.com 第二个 https://b.com 结束');
		expect(result).toEqual(['https://a.com', 'https://b.com']);
	});
});

// ============================================================================
// isValidUrl
// ============================================================================

describe('isValidUrl', () => {
	it('accepts valid HTTP and HTTPS URLs', () => {
		expect(isValidUrl('https://example.com')).toBe(true);
		expect(isValidUrl('http://example.com')).toBe(true);
		expect(isValidUrl('https://example.com/path?query=1#hash')).toBe(true);
	});

	it('rejects non-HTTP protocols', () => {
		expect(isValidUrl('ftp://example.com')).toBe(false);
		expect(isValidUrl('file:///path/to/file')).toBe(false);
		expect(isValidUrl('ws://example.com')).toBe(false);
	});

	it('rejects invalid URL strings', () => {
		expect(isValidUrl('not a url')).toBe(false);
		expect(isValidUrl('')).toBe(false);
		expect(isValidUrl('http://')).toBe(false);
	});
});
