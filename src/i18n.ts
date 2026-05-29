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
		zh: '每行一个网址，可粘贴含中文的分享文本...',
		en: 'One URL per line, or paste share text...',
	},
	'modal.saveNow': {
		zh: '立即保存',
		en: 'Save now',
	},
	'modal.invalidUrl': {
		zh: '第 ${line} 行链接格式无效: ${url}',
		en: 'Invalid URL on line ${line}: ${url}',
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
	'settings.queueLocation.name': {
		zh: '队列文件存储位置',
		en: 'Queue file location',
	},
	'settings.queueLocation.desc': {
		zh: '手机端和电脑端必须设置为相同位置。',
		en: 'Mobile and desktop must use the same location.',
	},
	'settings.queueLocation.vault': {
		zh: '笔记库 Share-to-Save 文件夹',
		en: 'Vault Share-to-Save folder',
	},
	'settings.queueLocation.plugin': {
		zh: '插件安装目录',
		en: 'Plugin directory',
	},
	'settings.queueLocation.syncHint': {
		zh: '请使用任意同步方式，在手机端和电脑端之间同步队列文件，电脑端检测到队列文件变化后会自动提取内容。',
		en: 'Use any sync method to sync the queue file between mobile and desktop. Desktop will automatically process changes when detected.',
	},
	'settings.queueLocation.syncPluginHint': {
		zh: '若选择"插件安装目录"，需使用支持配置同步的工具（如 ${link}）。',
		en: 'If "Plugin directory" is selected, use a config sync tool (e.g. ${link}).',
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
