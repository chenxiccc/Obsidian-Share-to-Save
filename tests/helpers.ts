/**
 * 测试辅助函数 / Test helpers
 */
import { parseHTML } from 'linkedom';

/**
 * 解析 HTML 字符串为 Document（使用 linkedom，与 defuddle 测试一致）
 * Parse HTML string to Document (using linkedom, consistent with defuddle tests)
 */
export function parseDocument(html: string): Document {
  const { document } = parseHTML(html);
  return document;
}

/**
 * 创建指定词数的英文文本 / Create English text with specified word count
 */
export function makeEnglishText(wordCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push('word');
  }
  return words.join(' ');
}

/**
 * 创建指定字符数的中文文本（每字符一词）/ Create Chinese text with specified char count (1 char = 1 word)
 */
export function makeChineseText(charCount: number): string {
  return '测'.repeat(charCount);
}
