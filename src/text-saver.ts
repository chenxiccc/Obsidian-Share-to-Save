/**
 * 文字保存器：将用户输入的文字直接保存到 Share-to-Save.md
 * Text saver: save user-entered text directly to Share-to-Save.md
 *
 * 与 URL 管线完全独立，不依赖 QueueManager / FileWatcher / Downloader
 * Completely independent from the URL pipeline
 */

import { Vault, TFile, normalizePath } from 'obsidian';
import type { ShareToSaveSettings } from './types';

/** 固定输出文件名 / Fixed output filename */
const NOTE_NAME = 'Share-to-Save.md';

export class TextSaver {
	constructor(
		private vault: Vault,
		private settings: ShareToSaveSettings,
	) {}

	/**
	 * 保存文字到 Share-to-Save.md（prepend 到 frontmatter 之下、已有内容之上）
	 * Save text to Share-to-Save.md (prepend below frontmatter, above existing content)
	 *
	 * 新建文件用 vault.create() — 触发 'create' 事件，注册到元数据缓存
	 * New file: vault.create() — triggers 'create' event, registers with metadata cache
	 *
	 * 修改已有文件用 vault.process() — 原子读-改-写，Obsidian 推荐方式
	 * Existing file: vault.process() — atomic read-modify-write, Obsidian recommended
	 *
	 * @param text 用户输入的文字 / User-entered text
	 * @param addTimestamp 是否添加时间戳 / Whether to add a timestamp heading
	 */
	async save(text: string, addTimestamp: boolean): Promise<void> {
		const filePath = normalizePath(`${this.settings.outputFolder}/${NOTE_NAME}`);

		// 时间戳 YYYY/MM/DD HH:mm:ss / Timestamp
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const ts = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

		let prefix: string;
		if (!addTimestamp) {
			prefix = '';
		} else {
			switch (this.settings.timestampFormat) {
				case 'h2':   prefix = `## ${ts}`; break;
				case 'h3':   prefix = `### ${ts}`; break;
				case 'body': prefix = ts; break;
				default:     prefix = `# ${ts}`;  // 'h1' or unrecognized
			}
		}

		const newBlock = prefix ? `\n${prefix}\n${text}\n` : `\n${text}\n`;

		const fileExists = await this.vault.adapter.exists(filePath);

		if (!fileExists) {
			// 确保目录存在 / Ensure directory exists
			const dirExists = await this.vault.adapter.exists(this.settings.outputFolder);
			if (!dirExists) {
				await this.vault.createFolder(this.settings.outputFolder);
			}
			// vault.create() — 触发 'create' 事件，返回 TFile
			await this.vault.create(filePath, `---\nsts_id: text\n---\n${newBlock}`);
		} else {
			// vault.process() — 原子读-改-写，防止并发数据丢失
			// vault.process() — atomic read-modify-write, prevents data loss
			const file = this.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				throw new Error(`${NOTE_NAME} is not a file`);
			}
			await this.vault.process(file, (data) => {
				// 找到 frontmatter 结束位置（第二个 ---）/ Find frontmatter end (second ---)
				const fmMatch = /^---[\s\S]*?^---/m.exec(data);
				if (fmMatch) {
					const fmEnd = fmMatch[0].length;
					// prepend: frontmatter + 新内容 + 旧 body
					// prepend: frontmatter + new content + old body
					return data.slice(0, fmEnd) + newBlock + data.slice(fmEnd);
				}
				// 防御：无 frontmatter（不应发生，但做兜底）/ Defensive: no frontmatter (shouldn't happen)
				return `---\nsts_id: text\n---\n${newBlock}${data}`;
			});
		}
	}
}
