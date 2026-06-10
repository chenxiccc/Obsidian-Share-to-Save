/**
 * 文字保存器：将用户输入的文字直接保存到 Share-to-Save.md
 * Text saver: save user-entered text directly to Share-to-Save.md
 *
 * 与 URL 管线完全独立，不依赖 QueueManager / FileWatcher / Downloader
 * Completely independent from the URL pipeline
 */

import { Vault, TFile, normalizePath } from 'obsidian';

/** 固定输出文件名 / Fixed output filename */
const NOTE_NAME = 'Share-to-Save.md';

export class TextSaver {
	constructor(
		private vault: Vault,
		private outputFolder: string,
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
	 */
	async save(text: string): Promise<void> {
		const filePath = normalizePath(`${this.outputFolder}/${NOTE_NAME}`);

		// 时间戳 YYYY/MM/DD HH:mm:ss / Timestamp
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const timestamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
		const newBlock = `\n# ${timestamp}\n${text}\n`;

		const fileExists = await this.vault.adapter.exists(filePath);

		if (!fileExists) {
			// 确保目录存在 / Ensure directory exists
			const dirExists = await this.vault.adapter.exists(this.outputFolder);
			if (!dirExists) {
				await this.vault.createFolder(this.outputFolder);
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
