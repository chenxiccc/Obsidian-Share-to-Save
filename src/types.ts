/**
 * 共享类型定义
 * Shared type definitions
 */

/** 队列条目 / Queue entry */
export interface QueueEntry {
	/** UUID v4 */
	id: string;
	/** 提取后的目标 URL / Extracted target URL */
	url: string;
	/** 来源平台 / Source platform */
	source: 'mobile' | 'desktop';
	/** 创建时间 ISO 8601 / Creation timestamp ISO 8601 */
	createdAt: string;
}

/** 队列条目（含文件路径），由 getPendingEntries 返回 / Queue entry with file path, returned by getPendingEntries */
export interface QueueEntryWithPath extends QueueEntry {
	/** 队列文件在 vault 中的完整路径 / Full path of queue file in vault */
	filePath: string;
}

/** 页面元数据（title/author/published）/ Page metadata */
export interface Metadata {
	title: string;
	author: string;
	published: string;
}

/** 页面解析结果（元数据 + 正文 + 图片列表）/ Page parse result (metadata + body + image list) */
export interface ParsedContent extends Metadata {
	content: string;
	imageUrls: string[];
}

/** 轮询间隔单位 / Poll interval unit */
export type PollIntervalUnit = 'seconds' | 'minutes' | 'hours';

/** 插件设置 / Plugin settings */
export interface ShareToSaveSettings {
	/** 输出文件夹名（默认 "Share-to-Save"）/ Output folder name (default "Share-to-Save") */
	outputFolder: string;
	/** 轮询间隔数值（1-60）/ Poll interval value (1-60) */
	pollIntervalValue: number;
	/** 轮询间隔单位 / Poll interval unit */
	pollIntervalUnit: PollIntervalUnit;
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

