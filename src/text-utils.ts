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

// ─── HTML 角度括号保护 / HTML Angle Bracket Protection ────────────────────

/** 占位符常量 / Placeholder constants */
export const ANGLT = 'ANGLT';
export const ANGGT = 'ANGGT';
/** 代码块保护占位符 / Code block protection sentinel */
const ANGLT_BLOCK = 'ANGLT_CODEBLOCK_';

/**
 * 预处理：将所有 &lt; &gt; 替换为占位符，防止 DOMParser 解码后 Turndown 输出原始 HTML 标签。
 * Pre-process: replace all &lt; &gt; with placeholders to prevent raw HTML tags in markdown output.
 *
 * 不在此阶段做行内代码包裹，因为插入 `` `<tag>` `` 到 rawHtml 后，DOMParser 会把 `<tag>` 解析为实际 HTML 标签。
 * 行内代码的智能转换在 restoreAngleBrackets 后处理阶段完成。
 * No inline code wrapping here — inserting `` `<tag>` `` into rawHtml causes DOMParser to parse as actual HTML.
 * Smart inline code conversion happens in restoreAngleBrackets post-processing.
 */
export function protectAngleBrackets(html: string): string {
	// 单遍替换：遇到 code/pre/title 块保持原样，其余 &lt;→ANGLT、&gt;→ANGGT
	// Single-pass: preserve code/pre/title blocks, replace other &lt;/&gt; with placeholders
	let blockIndex = 0;
	const blocks: string[] = [];
	return html.replace(
		/<(code|pre|title)\b[^>]*>[\s\S]*?<\/\1>|&lt;|&gt;/gi,
		match => {
			// code/pre/title 块 → 暂存并返回唯一占位符
			if (match.startsWith('<')) {
				blocks.push(match);
				return `${ANGLT_BLOCK}${blockIndex++}`;
			}
			if (match === '&lt;') return ANGLT;
			if (match === '&gt;') return ANGGT;
			return match;
		}
	).replace(
		new RegExp(`${ANGLT_BLOCK}(\\d+)`, 'g'),
		(_, idx) => blocks[parseInt(idx as string)] ?? ''
	);
}

/**
 * 后处理：恢复占位符，将 HTML 标签示例包裹为行内代码，其余保留为实体编码。
 * Post-process: restore placeholders, wrap HTML tag patterns as inline code, others as entities.
 *
 * 在 markdown 输出上操作（此时 `<` 是安全文本字符，不会被解析为 HTML），
 * 检测 ANGLT + 标签名 + ANGGT 模式转为 `` `<tag>` ``。
 * Operates on markdown output where `<` is safe text (not parsed as HTML),
 * detects ANGLT + tag name + ANGGT pattern → `` `<tag>` ``.
 *
 * 恢复顺序 / Restore order:
 *   1. ANGLT + HTML标签模式 + ANGGT → `` `<tag>` ``（行内代码）
 *   2. 其余 ANGLT/ANGGT → &lt; / &gt;（普通文本，渲染为 < / >）
 *
 * 注意：CODELT/CODEGT 已不再需要——第二轮 new DOMParser() 已不存在，
 * normalizeCodeBlocks 通过 textContent 直接设置文本，无需占位符保护。
 * Note: CODELT/CODEGT no longer needed — no second DOMParser round-trip.
 */
export function restoreAngleBrackets(markdown: string): string {
	// 快速短路：不含占位符时无需处理 / Fast path: skip if no placeholders
	if (!markdown.includes(ANGLT) && !markdown.includes(ANGGT)) return markdown;

	// 1. HTML 标签模式：ANGLT + 标签名 + 内容 + ANGGT → `<tag>`
	// 匹配 ANGLT(标签名+属性)ANGGT，其中标签名必须以字母开头
	markdown = markdown.replace(
		/ANGLT(\/?[a-zA-Z][\w-]*(?:\s+(?:[\w:-]+(?:\s*=\s*(?:"[^">]*"|'[^'>]*'|[^\s"'>]+))?)*)?\s*)ANGGT/g,
		(_full, inner: string) => {
			// 确保是合法 HTML 标签名（可选 / 后为字母）
			if (!/^[a-zA-Z]/.test(inner.replace(/^\//, ''))) {
				return _full;
			}
			return `\`<${inner}>\``;
		}
	);

	// 2. 其余 standalone 占位符 → 实体编码
	markdown = markdown
		.replace(/ANGLT/g, '&lt;')
		.replace(/ANGGT/g, '&gt;');

	return markdown;
}

// ─── Bold 元素 DOM 规范化 / Bold Element DOM Normalization ────────────────

/**
 * 规范化 Document 中的加粗元素：扁平化嵌套 + 确保 bold 与后续内容之间有空格。
 * Normalize bold elements in Document: flatten nesting + ensure space between bold and following content.
 *
 * 解决 Turndown 输出 **text**nextChar 导致 Obsidian Live Preview 无法识别关闭 ** 分隔符的问题。
 * Fixes **text**nextChar in Turndown output causing Obsidian Live Preview to fail delimiter recognition.
 *
 * 原地修改 Document，各 converter 通过 cloneNode 或直接使用继承规范化结果。
 * Modifies Document in place; converters inherit via cloneNode or direct use.
 */
export function normalizeBoldElements(doc: Document): void {
	// a. 扁平化嵌套的 strong/b 标签 / Flatten nested strong/b tags
	doc.querySelectorAll('strong strong, strong b, b strong, b b').forEach(el => {
		const parent = el.parentNode;
		if (!parent) return;
		while (el.firstChild) parent.insertBefore(el.firstChild, el);
		el.remove();
	});
	// b. 确保 bold 结束标签后有空格 / Ensure space after bold closing tag
	doc.querySelectorAll('strong, b').forEach(el => {
		const next = el.nextSibling;
		if (!next) return;
		// 文本节点：检查是否以非空白开头 / Text node: check if starts with non-whitespace
		if (next.nodeType === 3) {
			const text = next.textContent || '';
			if (text && !/^\s/.test(text)) {
				next.textContent = ' ' + text;
			}
			return;
		}
		// 元素节点：el.nextSibling === next 表示中间没有文本节点 / no text node between
		if (next.nodeType === 1 && el.nextSibling === next) {
			el.parentNode?.insertBefore(doc.createTextNode(' '), next);
		}
	});
}

// ─── 管线聚合入口 / Pipeline Aggregation Entry Points ─────────────────────

/**
 * 管线预处理入口：所有 Converter 统一执行。
 * Pipeline-only preprocess entry. Applied to all converters.
 *
 * 当前步骤 / Current steps:
 *   1. protectAngleBrackets — &lt;/&gt; → ANGLT/ANGGT 占位符 / placeholders
 *
 * @pipeline-only — 仅供 Downloader.processDocToParsed 调用 / only called from pipeline
 */
export function preprocessHtml(html: string): string {
	html = protectAngleBrackets(html);
	return html;
}

/**
 * 管线 DOM 规范化入口：所有 Converter 统一执行。
 * Pipeline-only DOM normalize entry. Applied to all converters.
 *
 * 当前步骤 / Current steps:
 *   1. normalizeBoldElements — 扁平化嵌套 strong/b，bold 后补空格 / flatten nesting + trailing space
 *
 * @pipeline-only — 仅供 Downloader.processDocToParsed 调用 / only called from pipeline
 */
export function normalizeDocument(doc: Document): void {
	normalizeBoldElements(doc);
}

/**
 * 管线后处理入口：所有 Converter 统一执行，适用于 Markdown 正文和 metadata 文本字段。
 * Pipeline-only postprocess entry. Applied to all converters.
 * Safe for both Markdown content and metadata text fields (title, author).
 *
 * 当前步骤 / Current steps:
 *   1. restoreAngleBrackets — ANGLT/ANGGT → 行内代码 / &lt; &gt;
 *   2. Tab → 空格            — 防止 Obsidian 将缩进解释为代码块 / prevent code-block rendering
 *
 * Tab 替换无需保护代码块：经过 Turndown 的 Converter 已自动清理 Tab，
 * 绕过 Turndown 的 Converter（XHS/OP）不生成代码块。
 * Code block protection not needed: Turndown-based converters auto-clean tabs;
 * non-Turndown converters (XHS/OP) don't produce code blocks.
 *
 * @pipeline-only — 仅供 Downloader.processDocToParsed 调用 / only called from pipeline
 */
export function postprocessContent(md: string): string {
	md = restoreAngleBrackets(md);
	md = md.replace(/\t/g, ' ');       // Tab → space / Obsidian code-block prevention
	return md;
}

