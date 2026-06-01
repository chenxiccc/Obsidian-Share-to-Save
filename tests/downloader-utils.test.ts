/**
 * downloader.ts 静态工具方法测试 / Tests for downloader static utility methods
 */
import { describe, it, expect } from 'vitest';
import { Downloader } from '../src/downloader';

describe('extractImageUrls', () => {
	it('extracts standard markdown image URLs', () => {
		const md = '![alt](https://example.com/image.png)';
		expect(Downloader.extractImageUrls(md)).toEqual(['https://example.com/image.png']);
	});

	it('extracts multiple images', () => {
		const md = '![a](https://a.com/1.jpg)\n![b](https://b.com/2.jpg)';
		expect(Downloader.extractImageUrls(md)).toEqual([
			'https://a.com/1.jpg',
			'https://b.com/2.jpg',
		]);
	});

	it('returns empty array for no images', () => {
		expect(Downloader.extractImageUrls('just text')).toEqual([]);
	});
});

describe('buildFrontmatter', () => {
	it('builds full frontmatter with all fields', () => {
		const parsed = {
			title: 'Test Title',
			author: 'Test Author',
			published: '2024-01-15',
			content: 'body',
			imageUrls: [],
		};
		const result = Downloader.buildFrontmatter(parsed, 'https://example.com', 'sts123');
		expect(result).toContain('source: "https://example.com"');
		expect(result).toContain('sts_id: "sts123"');
		expect(result).toContain('author:');
		expect(result).toContain('  - "Test Author"');
		expect(result).toContain('published:');
	});

	it('omits missing fields', () => {
		const parsed = {
			title: 'Just Title',
			author: '',
			published: '',
			content: 'body',
			imageUrls: [],
		};
		const result = Downloader.buildFrontmatter(parsed, 'https://x.com', 'id1');
		expect(result).not.toContain('author:');
		expect(result).not.toContain('published:');
	});
});

describe('formatDateTime', () => {
	it('formats ISO date string', () => {
		const result = Downloader.formatDateTime('2024-01-15T10:30:00Z');
		expect(result).toBe('2024-01-15T10:30:00');
	});

	it('returns null for invalid date', () => {
		expect(Downloader.formatDateTime('not a date')).toBeNull();
		expect(Downloader.formatDateTime('')).toBeNull();
	});
});

describe('stripWeChatTrackingParams', () => {
	it('strips tracking params from WeChat URL', () => {
		const url = 'https://mp.weixin.qq.com/s?__biz=xxx&mid=123&idx=1&sn=abc&chksm=extra';
		const result = Downloader.stripWeChatTrackingParams(url);
		expect(result).toContain('__biz=xxx');
		expect(result).toContain('mid=123');
		expect(result).not.toContain('chksm');
	});

	it('passes through non-WeChat URLs unchanged', () => {
		const url = 'https://example.com/article?param=value';
		expect(Downloader.stripWeChatTrackingParams(url)).toBe(url);
	});
});

describe('applyMetadataPatch', () => {
	it('applies title patch', () => {
		const meta = { title: 'Original', author: '', published: '' };
		(Downloader as any).applyMetadataPatch(meta, { title: 'Patched' });
		expect(meta.title).toBe('Patched');
	});

	it('ignores undefined patch', () => {
		const meta = { title: 'Original', author: 'A', published: '' };
		(Downloader as any).applyMetadataPatch(meta, undefined);
		expect(meta.title).toBe('Original');
	});
});
