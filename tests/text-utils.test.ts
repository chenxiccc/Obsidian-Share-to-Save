/**
 * text-utils.ts 测试 / Tests for text-utils.ts
 *
 * 聚焦 countWords 和 isMarkdownViable（重构新增函数）
 * Also covers: escapeObsidianTags, escapeLinkDestination, sanitizeFilename
 */
import { describe, it, expect } from 'vitest';
import { countWords, isMarkdownViable, escapeObsidianTags, escapeLinkDestination, sanitizeFilename } from '../src/text-utils';
import { makeEnglishText, makeChineseText } from './helpers';

// ============================================================================
// countWords
// ============================================================================

describe('countWords', () => {
	it('returns 0 for empty/whitespace', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('   \n\t  ')).toBe(0);
	});

	it('counts English words by whitespace', () => {
		expect(countWords('hello')).toBe(1);
		expect(countWords('hello world')).toBe(2);
		expect(countWords('the quick brown fox')).toBe(4);
	});

	it('counts CJK characters individually', () => {
		expect(countWords('你好')).toBe(2);
		expect(countWords('你好世界')).toBe(4);
		expect(countWords('中文测试')).toBe(4);
	});

	it('handles mixed CJK and English', () => {
		expect(countWords('Hello 世界')).toBe(3);
		expect(countWords('AI 时代')).toBe(3);
	});

	it('counts Japanese (Hiragana/Katakana) per character', () => {
		expect(countWords('こんにちは')).toBe(5);
		expect(countWords('テスト')).toBe(3);
	});

	it('counts Korean (Hangul) per character', () => {
		expect(countWords('안녕하세요')).toBe(5);
	});

	it('counts punctuation/numbers as part of words', () => {
		expect(countWords('hello-world')).toBe(1);
	});

	it('generates expected counts for large inputs', () => {
		expect(countWords(makeEnglishText(100))).toBe(100);
		expect(countWords(makeChineseText(100))).toBe(100);
	});
});

// ============================================================================
// isMarkdownViable
// ============================================================================

describe('isMarkdownViable', () => {
	it('returns true for >= 100 words', () => {
		expect(isMarkdownViable(makeEnglishText(100))).toBe(true);
		expect(isMarkdownViable(makeChineseText(100))).toBe(true);
	});

	it('returns false for < 50 words', () => {
		expect(isMarkdownViable(makeEnglishText(49))).toBe(false);
		expect(isMarkdownViable('short text')).toBe(false);
		expect(isMarkdownViable('')).toBe(false);
	});

	describe('50-99 word range', () => {
		it('returns true with headings and low link density', () => {
			const md = '## A Heading\n\n' + makeEnglishText(60);
			expect(isMarkdownViable(md)).toBe(true);
		});

		it('returns true with ### headings', () => {
			const md = '### Section\n\n' + makeEnglishText(55);
			expect(isMarkdownViable(md)).toBe(true);
		});

		it('returns false without headings', () => {
			const md = 'No heading here.\n\n' + makeEnglishText(60);
			expect(isMarkdownViable(md)).toBe(false);
		});

		it('returns false with high link density (nav page pattern)', () => {
			const links = Array(20).fill('[link](https://example.com/page)').join('\n');
			const md = '## Links\n\n' + links;
			expect(isMarkdownViable(md)).toBe(false);
		});

		it('returns true with headings and few links', () => {
			const md = '## Article\n\n' + makeEnglishText(60) + '\n\nSee [one link](https://example.com) for more.';
			expect(isMarkdownViable(md)).toBe(true);
		});
	});

	it('returns false for markdown that is only frontmatter-like separators', () => {
		expect(isMarkdownViable('---\n---\n')).toBe(false);
	});

	it('handles markdown with code blocks correctly', () => {
		const md = '## Code\n\n```\nhttps://example.com/config\n```\n\n' + makeEnglishText(55);
		expect(isMarkdownViable(md)).toBe(true);
	});
});

// ============================================================================
// escapeObsidianTags
// ============================================================================

describe('escapeObsidianTags', () => {
	it('escapes inline tags', () => {
		expect(escapeObsidianTags('hello #world')).toBe('hello \\#world');
		expect(escapeObsidianTags('#tag at start')).toBe('\\#tag at start');
	});

	it('does not escape heading markers', () => {
		expect(escapeObsidianTags('# Title')).toBe('# Title');
		expect(escapeObsidianTags('## Section')).toBe('## Section');
	});

	it('does not double-escape', () => {
		expect(escapeObsidianTags('already \\#escaped')).toBe('already \\#escaped');
	});

	it('does not escape punctuation after #', () => {
		expect(escapeObsidianTags('#. not a tag')).toBe('#. not a tag');
	});
});

// ============================================================================
// escapeLinkDestination
// ============================================================================

describe('escapeLinkDestination', () => {
	it('escapes parentheses in URLs', () => {
		expect(escapeLinkDestination('https://en.wikipedia.org/wiki/C_(programming_language)'))
			.toBe('https://en.wikipedia.org/wiki/C_\\(programming_language\\)');
	});

	it('wraps URLs with spaces', () => {
		expect(escapeLinkDestination('https://example.com/my page'))
			.toBe('<https://example.com/my page>');
	});

	it('passes through normal URLs', () => {
		expect(escapeLinkDestination('https://example.com')).toBe('https://example.com');
	});
});

// ============================================================================
// sanitizeFilename
// ============================================================================

describe('sanitizeFilename', () => {
	it('replaces illegal characters', () => {
		expect(sanitizeFilename('file:name')).toBe('file_name');
		expect(sanitizeFilename('a/b\\c')).toBe('a_b_c');
	});

	it('truncates to maxLength', () => {
		expect(sanitizeFilename('hello world', 5)).toBe('hello');
	});

	it('collapses whitespace', () => {
		expect(sanitizeFilename('hello   world')).toBe('hello world');
	});
});
