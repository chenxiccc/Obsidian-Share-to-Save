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
		zh: 'Share to Save：保存链接',
		en: 'Share to Save: Save URL',
	},
	'modal.title': {
		zh: '保存链接',
		en: 'Save URL',
	},
	'modal.placeholder': {
		zh: '每行一个网址，可粘贴含文字的分享文本...',
		en: 'One URL per line, or paste share text with letters...',
	},
	'modal.saveNow': {
		zh: '立即保存',
		en: 'Save now',
	},
	'modal.invalidUrl': {
		zh: '第 ${line} 行链接格式无效: ${url}',
		en: 'Invalid URL on line ${line}: ${url}',
	},
	'modal.settings': {
		zh: '打开插件设置',
		en: 'Open plugin settings',
	},
	'menu.button': {
		zh: '保存到 Share to Save',
		en: 'Save to Share to Save',
	},
	'settings.folder.name': {
		zh: '保存文件夹',
		en: 'Output folder',
	},
	'settings.folder.desc': {
		zh: '链接内容将保存到此文件夹下',
		en: 'Saved content will be placed in this folder',
	},
	'settings.usage.heading': {
		zh: '使用说明',
		en: 'Usage Instructions',
	},
	'settings.usage.content': {
		zh: '请使用任意同步方式，推荐 ${link}，在手机和电脑间同步该文件夹，手机和电脑需使用相同文件夹。电脑端接收到新队列文件后，会自动开始获取网页内容。',
		en: 'Use any sync method, recommends ${link}, to sync this folder between mobile and desktop. Both devices must use the same folder. Desktop will automatically extract content when new queue files are received.',
	},
	'settings.pollInterval.name': {
		zh: '轮询间隔',
		en: 'Polling interval',
	},
	'settings.pollInterval.desc': {
		zh: '电脑端检查队列目录中是否有新条目的间隔。建议 >= 5 秒。',
		en: 'How often desktop checks for new entries in the queue directory. Recommend >= 5 seconds.',
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
