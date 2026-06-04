/**
 * npm version 钩子（version 阶段）：将 package.json 的版本同步到 manifest.json 和 versions.json
 * npm version hook (version phase): sync version to manifest.json and versions.json
 *
 * 注意：tag 重命名由 postversion 钩子处理（此时 npm 已创建 v 前缀 tag）
 * Note: tag rename is handled by postversion hook (npm has created the v-prefixed tag by then)
 *
 * 用法 / Usage: npm version <newversion> 会自动触发
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const newVersion = pkg.version;

// 1. 更新 manifest.json / Update manifest.json
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
console.log(`  manifest.json → ${newVersion}`);

// 2. 更新 versions.json / Update versions.json
const versionsPath = path.join(root, 'versions.json');
let versions = {};
try {
	versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
} catch {
	// 文件不存在时创建 / Create if not exists
}
const minAppVersion = manifest.minAppVersion || '1.7.0';
versions[newVersion] = minAppVersion;
fs.writeFileSync(versionsPath, JSON.stringify(versions, null, '\t') + '\n');
console.log(`  versions.json → ${newVersion}: ${minAppVersion}`);

// 3. git add，确保被 npm version 的 commit 包含 / stage so npm version's commit includes them
execSync('git add manifest.json versions.json', { cwd: root, stdio: 'ignore' });
