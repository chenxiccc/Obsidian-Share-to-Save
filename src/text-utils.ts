/**
 * 文本工具函数：词数统计、内容质量评估、Obsidian 标签转义、Markdown 链接转义、文件名清理
 * Text utilities: word counting, content quality assessment, Obsidian tag escaping,
 * Markdown link escaping, filename sanitization
 *
 * 所有函数均为纯字符串转换，零外部依赖。
 * All functions are pure string transformations with zero external dependencies.
 */

// ─── 词数统计与内容质量评估 / Word Counting & Content Quality ──────────────

// 一-鿿: CJK Unified Ideographs / CJK 统一表意文字
// 㐀-䶿: CJK Extension A / CJK 扩展 A
// ぀-ゟ: Hiragana / 平假名
// ゠-ヿ: Katakana / 片假名
// 가-힯: Hangul Syllables / 韩文音节
const CJK_RE = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/g;

/**
 * 统计文本词数。
 * CJK 字符逐个计为 1 词，非 CJK 按空白分词。
 * Count words in text.
 * CJK characters count 1 word each; non-CJK splits by whitespace.
 */
export function countWords(text: string): number {
	if (!text?.trim()) return 0;
	const cjkCount = (text.match(CJK_RE) || []).length;
	const nonCjkText = text.replace(CJK_RE, ' ');
	const nonCjkWords = nonCjkText.split(/\s+/).filter(w => w.length > 0).length;
	return cjkCount + nonCjkWords;
}

/**
 * 判断 converter 输出的 Markdown 是否具备有效内容。
 * 替代 downloader 中基于原始 HTML 的 isQualityPoor/isMinimallyViable，
 * 在管线输出端评估质量。
 *
 * Check if converter output Markdown has viable content.
 * Replaces the raw-HTML-based isQualityPoor/isMinimallyViable in downloader,
 * evaluating quality at the pipeline output.
 */
export function isMarkdownViable(markdown: string): boolean {
	const words = countWords(markdown);

	// 长文本（≥100 词）：直接判定为有效 / Long text: directly viable
	if (words >= 100) return true;

	// 短文本（<50 词）：内容不足 / Short text: insufficient
	if (words < 50) return false;

	// 中等长度（50-99 词）：需要结构特征支撑 / Medium: need structural evidence
	const hasHeadings = /^#{2,3}\s/m.test(markdown);

	// 链接密度检测（导航页特征是高链接密度）/ Link density check (nav pages have high link density)
	const linkChars = (markdown.match(/https?:\/\/\S+/g) || []).join('').length;
	const linkRatio = linkChars / Math.max(markdown.length, 1);
	const isNavDense = linkRatio > 0.3;

	return hasHeadings && !isNavDense;
}

// ─── Obsidian 标签转义 / Obsidian Tag Escaping ─────────────────────────────

/**
 * 转义行中 # 防止 Obsidian 误识别为标签。
 * Escape mid-line # to prevent Obsidian from interpreting them as tags.
 *
 * 采用 Unicode property escapes (\p{L}, \p{N}) 判断 # 后字符类别，
 * 自动覆盖全部 Unicode 书写系统，无需维护硬编码 range 列表。
 * Uses Unicode property escapes to check character categories,
 * automatically covering all writing systems without hardcoded ranges.
 *
 * 不转义 / Does NOT escape:
 *   - \#already_escaped  — 双重转义防护 / double-escape guard
 *   - # Title / ## Heading — # 后跟空白，正则 \S 不匹配 / # followed by whitespace
 *   - #.punctuation       — 非 tag 合法首字符 / not a valid tag start character
 */
export function escapeObsidianTags(text: string): string {
	return text.replace(/(^|\W)#(\S)/gu, (match, prefix, following) => {
		// 已转义 → 跳过 / Already escaped → skip
		if ((prefix as string).endsWith('\\')) return match;

		// Obsidian tag 合法首字符：字母、数字、_、-、/
		// Obsidian tag legal start characters: letter, number, _, -, /
		if (
			/\p{L}/u.test(following as string) ||
			/\p{N}/u.test(following as string) ||
			following === '_' ||
			following === '-' ||
			following === '/'
		) {
			return prefix + '\\#' + following;
		}

		// 非 tag 首字符（如标点）→ 原样 / Not a tag start → leave as-is
		return match;
	});
}

// ─── Markdown 链接转义 / Markdown Link Escaping ────────────────────────────

/**
 * 转义 Markdown 链接目标 URL 中的特殊字符。
 * Escape special characters in a Markdown link destination URL.
 *
 * <>() 用反斜杠转义；含空格的 URL 额外用尖括号包裹。
 * <>() are backslash-escaped; URLs containing spaces are angle-bracket wrapped.
 */
export function escapeLinkDestination(destination: string): string {
	const escaped = destination.replace(/([<>()])/g, '\\$1');
	return escaped.indexOf(' ') >= 0 ? '<' + escaped + '>' : escaped;
}

// ─── 文件名清理 / Filename Sanitization ────────────────────────────────────

/** Obsidian 仓库文件名中非法的字符 / Characters illegal in Obsidian vault filenames */
const FILENAME_ILLEGAL_RE = /[/\\:*?"<>|#^[\]]/g;

/**
 * 清理字符串为安全的文件名。替换非法字符为 _，合并空白，可选截断。
 * Sanitize a string for use as a filename. Replaces illegal chars with _,
 * collapses whitespace, optionally truncates.
 */
export function sanitizeFilename(name: string, maxLength?: number): string {
	let result = name
		.replace(FILENAME_ILLEGAL_RE, '_')
		.replace(/\s+/g, ' ')
		.trim();
	if (maxLength !== undefined && result.length > maxLength) {
		result = result.slice(0, maxLength);
	}
	return result;
}
