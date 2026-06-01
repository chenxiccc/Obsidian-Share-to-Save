/**
 * Obsidian API mock（测试用）/ Obsidian API mock for tests
 */

export class Vault {
	adapter = {
		exists: async (_path: string) => false,
	};
	createFolder = async (_path: string) => {};
	create = async (_path: string, _data: string) => {};
}

export function normalizePath(path: string): string {
	return path;
}
