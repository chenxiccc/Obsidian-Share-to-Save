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
		zh: '粘贴链接或分享文本...',
		en: 'Paste URL or share text...',
	},
	'modal.saveQueue': {
		zh: '保存到队列',
		en: 'Save to queue',
	},
	'modal.processNow': {
		zh: '立即处理',
		en: 'Process now',
	},
	'modal.cancel': {
		zh: '关闭',
		en: 'Close',
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
	'notice.noUrl': {
		zh: '未找到有效链接',
		en: 'No valid URL found',
	},
	'notice.saved': {
		zh: '已保存到队列',
		en: 'Saved to queue',
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
