/**
 * 中英文字符串表
 * Chinese/English string table
 *
 * 语言选择逻辑 / Language selection logic:
 * - Obsidian 界面语言是中文 → 简体中文
 * - 否则 → 英文
 */

export type Locale = 'zh' | 'en';
export type Translator = (key: string, params?: Record<string, string>) => string;

/** 所有 UI 字符串 / All UI strings */
export const STRINGS: Record<string, { zh: string; en: string }> = {
	'ribbon.tooltip': {
		zh: 'Share to Save：保存内容',
		en: 'Share to Save: Save Content',
	},
	'modal.title': {
		zh: '保存内容',
		en: 'Save Content',
	},
	'modal.placeholder': {
		zh: '如要保存网页内容，需每行一个网址，可粘贴含文字的分享文本。',
		en: 'To save webpages, enter one URL per line. You can paste shared text containing URLs.',
	},
	'modal.saveWebpage': {
		zh: '保存网页',
		en: 'Save Webpage',
	},
	'modal.saveText': {
		zh: '保存文字',
		en: 'Save Text',
	},
	'modal.invalidUrl': {
		zh: '第 ${line} 行链接格式无效: ${url}',
		en: 'Invalid URL on line ${line}: ${url}',
	},
	'modal.settings': {
		zh: '打开插件设置',
		en: 'Open plugin settings',
	},
	'modal.paste': {
		zh: '读取剪贴板',
		en: 'Paste from clipboard',
	},
	'modal.timestampOn': {
		zh: '启用时间戳',
		en: 'Enable timestamp',
	},
	'modal.timestampOff': {
		zh: '停用时间戳',
		en: 'Disable timestamp',
	},
	'menu.saveText': {
		zh: '保存文字',
		en: 'Save Text',
	},
	'menu.saveWebpage': {
		zh: '保存网页',
		en: 'Save Webpage',
	},
	'settings.folder.name': {
		zh: '保存文件夹',
		en: 'Output folder',
	},
	'settings.folder.desc': {
		zh: '链接内容将保存到此文件夹下。如果要修改，需要电脑和手机的插件配置修改为相同文件夹名称',
		en: 'Saved content will be placed in this folder. If you change it, update both desktop and mobile plugin settings to the same folder name',
	},
	'settings.folder.empty': {
		zh: '文件夹名不能为空',
		en: 'Folder name cannot be empty',
	},
	'settings.folder.illegalChars': {
		zh: '文件夹名含非法字符，仅允许字母、数字、空格、-、_、.、/',
		en: 'Folder name contains invalid characters. Only letters, numbers, spaces, -, _, ., / are allowed',
	},
	'settings.folder.consecutiveSlashes': {
		zh: '文件夹名不允许连续斜杠 //',
		en: 'Consecutive slashes // are not allowed in folder name',
	},
	'settings.folder.leadingTrailing': {
		zh: '文件夹名首尾不允许斜杠、点号或空格',
		en: 'Folder name cannot start or end with slash, dot, or space',
	},
	'settings.folder.emptySegment': {
		zh: '文件夹名每段路径不能为空',
		en: 'Each path segment in folder name cannot be empty',
	},
	'settings.title': {
		zh: 'Share to Save 设置',
		en: 'Share to Save Settings',
	},
	'settings.usage.heading': {
		zh: '使用说明',
		en: 'Instructions',
	},
	'settings.usage.content': {
		zh: '请使用任意同步方式，推荐 ${link}，在手机和电脑间同步该文件夹，手机和电脑需使用相同文件夹。电脑端接收到新队列文件后，会自动开始获取网页内容。',
		en: 'Use any sync method to sync this folder between mobile and desktop. We recommend ${link}. Both devices must use the same folder name. Desktop will automatically download web content when new queue files arrive.',
	},
	'settings.pollInterval.name': {
		zh: '检测间隔',
		en: 'Polling interval',
	},
	'settings.pollInterval.desc': {
		zh: '电脑端检测队列目录中是否有新条目的间隔。建议 >= 5 秒。',
		en: 'How often the desktop checks the queue directory for new entries. Recommend >= 5 seconds.',
	},
	'settings.pollInterval.seconds': {
		zh: '秒',
		en: 'seconds',
	},
	'settings.pollInterval.minutes': {
		zh: '分钟',
		en: 'minutes',
	},
	'settings.pollInterval.hours': {
		zh: '小时',
		en: 'hours',
	},
	'settings.timestampFormat.name': {
		zh: '时间戳格式',
		en: 'Timestamp format',
	},
	'settings.timestampFormat.desc': {
		zh: '保存文字时，时间戳的标题级别',
		en: 'Heading level for timestamp when saving text',
	},
	'settings.timestampFormat.h1': {
		zh: 'H1 标题',
		en: 'H1 heading',
	},
	'settings.timestampFormat.h2': {
		zh: 'H2 标题',
		en: 'H2 heading',
	},
	'settings.timestampFormat.h3': {
		zh: 'H3 标题',
		en: 'H3 heading',
	},
	'settings.timestampFormat.body': {
		zh: '正文',
		en: 'Body text',
	},

	'settings.shortcut.heading': {
		zh: '添加桌面快捷方式：从主屏幕一键直达插件输入框',
		en: 'Add to Home Screen: One-tap access to the plugin input from your home screen',
	},
	'settings.shortcut.ios.heading': {
		zh: 'iOS 创建桌面快捷方式',
		en: 'iOS: Add to Home Screen',
	},
	'settings.shortcut.ios.desc': {
		zh: '打开快捷指令 App → 新建快捷指令 → 添加操作「打开 URL」→ 填入下方链接 → 点分享按钮 → 添加到主屏幕',
		en: 'Open Shortcuts app → New Shortcut → Add Action "Open URL" → Fill in the link below → Tap Share → Add to Home Screen',
	},
	'settings.shortcut.ios.uriLabel': {
		zh: 'URL',
		en: 'URL',
	},
	'settings.shortcut.android.heading': {
		zh: 'Android 创建桌面快捷方式',
		en: 'Android: Add to Home Screen',
	},
	'settings.shortcut.android.desc': {
		zh: '使用 ${link} 新建一个 Intent（意图）并填写以下四个参数：',
		en: 'Use ${link} to create a new Intent and fill in the four parameters below:',
	},
	'settings.shortcut.action': {
		zh: '操作',
		en: 'Action',
	},
	'settings.shortcut.package': {
		zh: '程序包名称',
		en: 'Package',
	},
	'settings.shortcut.class': {
		zh: '类名',
		en: 'Class',
	},
	'settings.shortcut.data': {
		zh: '数据',
		en: 'Data URI',
	},
	'settings.shortcut.copy': {
		zh: '复制',
		en: 'Copy',
	},
	'settings.shortcut.copied': {
		zh: '已复制到剪贴板',
		en: 'Copied to clipboard',
	},

	'failed.body': {
		zh: '提取失败，请手动保存，可以用Obsidian的核心插件网页浏览器，也可以用[Obsidian Web Clipper](https://obsidian.md/zh/clipper)。',
		en: 'Extraction failed. Please save manually using Obsidian\'s core plugin "Web Browser" or [Obsidian Web Clipper](https://obsidian.md/clipper).',
	},

	'notice.noUrl': {
		zh: '未找到有效链接',
		en: 'No valid URL found',
	},
	'notice.saved': {
		zh: '已保存到队列',
		en: 'Saved to queue',
	},
	'notice.savedMultiple': {
		zh: '已保存 ${count} 个链接到队列',
		en: 'Saved ${count} URLs to queue',
	},
	'notice.textSaved': {
		zh: '已保存文字',
		en: 'Text saved',
	},
	'notice.savedTitle': {
		zh: '已保存: ${title}',
		en: 'Saved: ${title}',
	},
	'notice.downloadFailed': {
		zh: '下载失败: ${error}',
		en: 'Download failed: ${error}',
	},
	'notice.processing': {
		zh: '正在处理队列...',
		en: 'Processing queue...',
	},
	'notice.noPending': {
		zh: '没有待处理的链接',
		en: 'No pending URLs',
	},

	// ── 图片保存 / Image save ──
	'menu.saveImage': {
		zh: '保存图片',
		en: 'Save Image',
	},
	'notice.imageSavedName': {
		zh: '图片已保存: ${name}',
		en: 'Image saved: ${name}',
	},
	'notice.imagesSaved': {
		zh: '已保存 ${count} 张图片',
		en: 'Saved ${count} images',
	},
	'notice.imageSavedPartial': {
		zh: '已保存 ${ok} 张，${fail} 张失败',
		en: 'Saved ${ok}, ${fail} failed',
	},
	'notice.imageFailed': {
		zh: '图片保存失败',
		en: 'Image save failed',
	},
};

/**
 * 从 Obsidian 语言设置检测语言环境
 * Detect locale from Obsidian language setting
 */
export function detectLocale(language: string): Locale {
	// Obsidian 中文语言标识为 'zh' 或 'zh-CN' / Obsidian Chinese locale is 'zh' or 'zh-CN'
	if (language && language.startsWith('zh')) {
		return 'zh';
	}
	return 'en';
}

/**
 * 创建翻译函数
 * Create translator function
 */
export function createTranslator(locale: Locale): Translator {
	return (key: string, params?: Record<string, string>): string => {
		const entry = STRINGS[key];
		if (!entry) {
			return key;
		}
		let text = entry[locale] ?? entry['en'];
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				text = text.replace(`\${${k}}`, v);
			}
		}
		return text;
	};
}
