/**
 * 共享类型定义
 * Shared type definitions
 */

/** tobesave.json 队列条目的生命周期状态 / Lifecycle states of a queue entry */
export type QueueStatus = 'pending' | 'processing' | 'error';

/** tobesave.json 单个条目 / Single entry in tobesave.json */
export interface QueueEntry {
	/** UUID v4 */
	id: string;
	/** 提取后的目标 URL / Extracted target URL */
	url: string;
	/** 来源平台 / Source platform */
	source: 'mobile' | 'desktop';
	/** 处理状态 / Processing status */
	status: QueueStatus;
	/** 创建时间 ISO 8601 / Creation timestamp ISO 8601 */
	createdAt: string;
	/** 文章标题（下载后填充）/ Article title (filled after download) */
	title: string;
	/** 错误信息（status='error' 时）/ Error message (when status='error') */
	error: string | null;
}

/** tobesave.json 文件全量结构 / Full file structure */
export type QueueFile = QueueEntry[];

/** 页面元数据（title/author/authorUrl/published）/ Page metadata */
export interface Metadata {
	title: string;
	author: string;
	authorUrl?: string;
	published: string;
}

/** 页面解析结果（元数据 + 正文 + 图片列表）/ Page parse result (metadata + body + image list) */
export interface ParsedContent extends Metadata {
	content: string;
	imageUrls: string[];
}

/** 插件设置 / Plugin settings */
export interface ShareToSaveSettings {
	/** 输出文件夹名（默认 "Sts"）/ Output folder name (default "Sts") */
	outputFolder: string;
}

/** 图片下载结果 / Image download result */
export interface ImageDownloadResult {
	/** 本地文件名 / Local filename */
	filename: string;
	/** 原始 URL / Original URL */
	originalUrl: string;
	/** Vault 内完整路径 / Full path within vault */
	localPath: string;
}

/** 下载处理结果 / Download processing result */
export interface ProcessResult {
	success: boolean;
	title?: string;
	error?: string;
}

// ─── 共享常量 / Shared Constants ─────────────────────────────────────────────

/** Node.js 请求 / headless BrowserWindow / 图片下载共用的 Chrome UA */
/** Shared Chrome UA for Node.js fetch / headless BrowserWindow / image download */
export const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Safari/537.36';
