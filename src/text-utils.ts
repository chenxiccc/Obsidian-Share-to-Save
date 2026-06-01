/**
 * 文本工具函数：Obsidian 标签转义、Markdown 链接转义、文件名清理
 * Text utilities: Obsidian tag escaping, Markdown link escaping, filename sanitization
 *
 * 所有函数均为纯字符串转换，零外部依赖。
 * All functions are pure string transformations with zero external dependencies.
 */

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
