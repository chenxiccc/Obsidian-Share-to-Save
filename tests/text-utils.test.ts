/**
 * text-utils.ts 测试 / Tests for text-utils.ts
 *
 * Covers: computeEffectiveContent, escapeObsidianTags, escapeLinkDestination, sanitizeFilename, validateFolderPath
 */
import { describe, it, expect } from 'vitest';
import { computeEffectiveContent, escapeObsidianTags, escapeLinkDestination, sanitizeFilename, validateFolderPath } from '../src/text-utils';

// ============================================================================
// computeEffectiveContent
// ============================================================================

describe('computeEffectiveContent', () => {
	it('returns empty string for empty markdown', () => {
		expect(computeEffectiveContent('')).toBe('');
		expect(computeEffectiveContent('   ')).toBe('');
	});

	it('strips frontmatter', () => {
		const md = '---\ntitle: Test\nauthor: Me\n---\n\nActual content here.';
		expect(computeEffectiveContent(md)).toBe('Actual content here.');
	});

	it('strips image links', () => {
		expect(computeEffectiveContent('![alt](https://example.com/img.png)')).toBe('');
		expect(computeEffectiveContent('Text before ![img](url) and after')).toBe('Text before  and after');
	});

	it('strips blank lines', () => {
		expect(computeEffectiveContent('\n\nhello\n\n\nworld\n\n')).toBe('hello\nworld');
	});

	it('returns text-only content ignoring images and frontmatter', () => {
		const md = '---\ntitle: X\n---\n\n## Heading\n\nParagraph text.\n\n![hero](https://x.com/hero.jpg)\n\nMore text.';
		expect(computeEffectiveContent(md)).toBe('## Heading\nParagraph text.\nMore text.');
	});

	it('returns empty for image-only markdown', () => {
		expect(computeEffectiveContent('![a](https://a.com/1.jpg)\n![b](https://b.com/2.jpg)')).toBe('');
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

	it('strips leading/trailing dots and spaces', () => {
		expect(sanitizeFilename('...hidden')).toBe('hidden');
		expect(sanitizeFilename('trailing...')).toBe('trailing');
		expect(sanitizeFilename('  spaces  ')).toBe('spaces');
		expect(sanitizeFilename('.dotfile')).toBe('dotfile');
	});

	it('fallback to untitled when all chars stripped', () => {
		expect(sanitizeFilename('...')).toBe('untitled');
		expect(sanitizeFilename('   ')).toBe('untitled');
		expect(sanitizeFilename('')).toBe('untitled');
	});
});

// ============================================================================
// validateFolderPath
// ============================================================================

describe('validateFolderPath', () => {
	it('returns null for valid paths', () => {
		expect(validateFolderPath('Share-to-Save')).toBeNull();
		expect(validateFolderPath('My Folder')).toBeNull();
		expect(validateFolderPath('sub/dir')).toBeNull();
		expect(validateFolderPath('a.b.c')).toBeNull();
	});

	it('detects empty', () => {
		expect(validateFolderPath('')).toBe('settings.folder.empty');
		expect(validateFolderPath('   ')).toBe('settings.folder.empty');
	});

	it('detects illegal characters', () => {
		expect(validateFolderPath('folder:name')).toBe('settings.folder.illegalChars');
		expect(validateFolderPath('a*b')).toBe('settings.folder.illegalChars');
		expect(validateFolderPath('test?')).toBe('settings.folder.illegalChars');
	});

	it('detects consecutive slashes', () => {
		expect(validateFolderPath('a//b')).toBe('settings.folder.consecutiveSlashes');
	});

	// Note: leading/trailing spaces are already removed by trim(), so only
	// dots and slashes are tested here
	it('detects leading/trailing dots and slashes', () => {
		expect(validateFolderPath('/leading')).toBe('settings.folder.leadingTrailing');
		expect(validateFolderPath('trailing/')).toBe('settings.folder.leadingTrailing');
		expect(validateFolderPath('.hidden')).toBe('settings.folder.leadingTrailing');
		expect(validateFolderPath('trailing.')).toBe('settings.folder.leadingTrailing');
	});

	it('detects empty segments', () => {
		expect(validateFolderPath('a/ /b')).toBe('settings.folder.emptySegment');
	});
});
