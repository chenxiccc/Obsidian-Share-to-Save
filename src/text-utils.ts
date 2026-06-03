/**
 * 文本工具函数：有效内容计算、Obsidian 标签转义、Markdown 链接转义、文件名清理、标题规范化
 * Text utilities: effective content computation, Obsidian tag escaping,
 * Markdown link escaping, filename sanitization, title normalization
 *
 * 所有函数均为纯字符串转换，零外部依赖。
 * All functions are pure string transformations with zero external dependencies.
 */

/**
 * 计算 Markdown 有效文本内容：去除 frontmatter、图片链接、空白行后的纯文本。
 * Compute effective text content: plain text after removing frontmatter, image links, blank lines.
 *
 * 用于二值判断"是否有内容"，不依赖词数/字符数阈值。
 * Used for binary "has content" check, no word/character count threshold.
 */
export function computeEffectiveContent(markdown: string): string {
	const noFrontmatter = markdown.replace(/^---[\s\S]*?---\n*/m, '');
	const noImages = noFrontmatter.replace(/!\[.*?\]\([^)]*\)/g, '');
	const noBlankLines = noImages.replace(/^\s*\n/gm, '');
	return noBlankLines.trim();
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
 * 清理字符串为安全的文件名。替换非法字符为 _，合并空白，去首尾点号/空格，可选截断。
 * Sanitize a string for use as a filename. Replaces illegal chars with _,
 * collapses whitespace, strips leading/trailing dots/spaces, optionally truncates.
 *
 * Windows 不允许文件名以点号或空格结尾，此函数确保跨平台兼容。
 * Windows does not allow filenames ending with dots or spaces; this ensures cross-platform compatibility.
 */
export function sanitizeFilename(name: string, maxLength?: number): string {
	let result = name
		.replace(FILENAME_ILLEGAL_RE, '_')
		.replace(/\s+/g, ' ')
		.trim();
	// 去除首尾点号和空格（Windows 兼容）/ Strip leading/trailing dots and spaces (Windows compat)
	result = result.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
	if (!result) result = 'untitled';
	if (maxLength !== undefined && result.length > maxLength) {
		result = result.slice(0, maxLength);
	}
	return result;
}

// ─── 标题规范化 / Title Normalization ──────────────────────────────────────

// ─── 文件夹路径验证 / Folder Path Validation ───────────────────────────────

/** 文件夹路径允许的字符白名单 / Allowed character whitelist for folder paths */
const FOLDER_PATH_ALLOWED_RE = /[^\p{L}\p{N}\s._/-]/u;

/**
 * 验证文件夹路径是否安全。返回 null 表示合法，否则返回错误消息 key。
 * Validate folder path safety. Returns null if valid, otherwise error message key.
 *
 * 规则 / Rules:
 *   - 非空 / non-empty
 *   - 仅允许 Unicode 字母、数字、空格、-、_、.、/ / only Unicode letters, numbers, space, -, _, ., /
 *   - 不允许连续斜杠 / no consecutive slashes
 *   - 不允许首尾斜杠、点号、空格 / no leading/trailing slash, dot, or space
 *   - 每段路径非空 / each segment non-empty
 */
export function validateFolderPath(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return 'settings.folder.empty';

	// 白名单检测 / Whitelist check
	if (FOLDER_PATH_ALLOWED_RE.test(trimmed)) return 'settings.folder.illegalChars';

	// 连续斜杠 / Consecutive slashes
	if (trimmed.includes('//')) return 'settings.folder.consecutiveSlashes';

	// 首尾字符 / Leading/trailing characters
	if (/^[.\s/]/.test(trimmed) || /[.\s/]$/.test(trimmed)) {
		return 'settings.folder.leadingTrailing';
	}

	// 每段非空 / Each segment non-empty
	if (trimmed.split('/').some(seg => !seg.trim())) return 'settings.folder.emptySegment';

	return null;
}

/**
 * 白名单：Unicode 字母 + 数字 + 空格 + 少量标点。其余字符全部移除。
 * Whitelist: Unicode letters + numbers + space + limited punctuation. All else removed.
 *
 * \p{L} 涵盖全部 Unicode 书写系统（中文/英文/日文/韩文/阿拉伯文等），
 * 自动排除 emoji、零宽字符、控制符、数学符号等。
 * \p{L} covers all Unicode writing systems (CJK/Latin/Japanese/Korean/Arabic/etc.),
 * automatically excluding emoji, zero-width chars, control chars, math symbols, etc.
 */
const TITLE_ALLOWED_RE = /[^\p{L}\p{N}\s\-_.,、。！？：；""''（）【】《》…—·]/gu;

/**
 * 规范化标题：去特殊字符 → 合并空白 → 截断到指定长度。
 * Normalize title: remove special chars → collapse whitespace → truncate to max length.
 *
 * 先白名单过滤再截断，确保截断的是有效字符数。
 * Characters are counted as UTF-16 code units: 1 Chinese char = 1, 1 English letter = 1.
 * Emoji and other surrogate-pair chars are already removed by the whitelist.
 */
export function normalizeTitle(title: string, maxLength = 60): string {
	return title
		.replace(TITLE_ALLOWED_RE, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLength)
		.trim();
}
