#!/bin/bash
# Share to Save 测试脚本 / Test script
# 覆盖所有历史问题 URL / Covers all historically problematic URLs

set -e

VAULT="Obsidian"
PLUGIN_DIR="$HOME/Obsidian/.obsidian/plugins/share-to-save"
OUTPUT_DIR="$HOME/Obsidian/Sts"
QUEUE_FILE="$PLUGIN_DIR/tobesave.json"

echo "=========================================="
echo "  Share to Save 测试"
echo "=========================================="

# 1. 构建并同步 / Build and sync
echo ""
echo "[1/4] 构建插件 / Building plugin..."
cd "$(dirname "$0")"
npx tsc -noEmit -skipLibCheck
node esbuild.config.mjs production
cp main.js "$PLUGIN_DIR/"
echo "  ✅ 构建完成"

# 2. 清理旧数据 / Clean old data
echo ""
echo "[2/4] 清理旧数据 / Cleaning old data..."
rm -rf "$OUTPUT_DIR" "$QUEUE_FILE" 2>/dev/null
obsidian vault="$VAULT" plugin:reload id=share-to-save
echo "  ✅ 已清理"

# 3. 写入测试用例 / Write test cases
echo ""
echo "[3/4] 写入测试用例 / Writing test cases..."

# 每个测试用例附带标签说明历史问题
cat > "$QUEUE_FILE" << 'EOF'
[
  {
    "id": "test-a",
    "url": "https://mp.weixin.qq.com/s/9O6-bEp5OYWc9PHUrrobGg",
    "source": "desktop",
    "status": "pending",
    "createdAt": "2026-05-27T10:00:00.000Z",
    "title": "",
    "error": null
  },
  {
    "id": "test-b",
    "url": "https://mp.weixin.qq.com/s?__biz=Mzk0MDg0MTkzOA==&mid=2247496343&idx=1&sn=0b45a2cab0977a65a57efc41199c0a94&chksm=c3f15b6a2433b6db1db467f2e2355c7751352a828cc3e66cbfc8db9b70159e94b7e5f2b1344e&mpshare=1&scene=1&srcid=03268NCfvAMQ43ETjxTODp8F&sharer_shareinfo=efc2fbb67de87858104dceba6c2c5a99&sharer_shareinfo_first=efc2fbb67de87858104dceba6c2c5a99&from=groupmessage&isappinstalled=0&clicktime=1774488076&enterid=1774488076",
    "source": "desktop",
    "status": "pending",
    "createdAt": "2026-05-27T10:01:00.000Z",
    "title": "",
    "error": null
  },
  {
    "id": "test-c",
    "url": "https://mp.weixin.qq.com/s?__biz=Mzk0MDg0MTkzOA==&mid=2247491206&idx=1&sn=01edc2c8a46729c96476bc6e5920dd93&chksm=c3ff681c06ef3fe66ed335f518a9e2a3b3e2c4166b3dd16747501db3abe30843b537aa2f1d53&scene=126&sessionid=0&clicktime=1755262892&enterid=1755262892",
    "source": "desktop",
    "status": "pending",
    "createdAt": "2026-05-27T10:02:00.000Z",
    "title": "",
    "error": null
  },
  {
    "id": "test-d",
    "url": "http://xhslink.com/o/7qRdeYADO8c",
    "source": "desktop",
    "status": "pending",
    "createdAt": "2026-05-27T10:03:00.000Z",
    "title": "",
    "error": null
  }
]
EOF

echo "  ✅ 已写入 $(python3 -c "import json; print(len(json.load(open('$QUEUE_FILE'))))") 条用例"

# 4. 触发处理并验证 / Trigger processing and validate
echo ""
echo "[4/4] 触发处理 / Triggering processing..."
sleep 3

obsidian vault="$VAULT" eval code="(async () => {
    const p = app.plugins.plugins['share-to-save'];
    if (!p) return 'plugin not found';
    await p.fileWatcher.processNow();
    return 'done';
})()"

echo ""
echo "=========================================="
echo "  验证结果 / Results"
echo "=========================================="

# 检查生成的 Markdown 文件
echo ""
echo "--- 生成的文件 / Generated files ---"
ls -la "$OUTPUT_DIR"/*.md 2>/dev/null || echo "  ❌ 无 .md 文件"

echo ""
echo "--- 附件 / Attachments ---"
ATTACH_COUNT=$(ls "$OUTPUT_DIR/attachments/" 2>/dev/null | wc -l | tr -d ' ')
echo "  附件数: $ATTACH_COUNT"

# 逐文件检查
for f in "$OUTPUT_DIR"/*.md; do
    [ -f "$f" ] || continue
    BASENAME=$(basename "$f")
    SIZE=$(wc -c < "$f" | tr -d ' ')
    IMG_COUNT=$(grep -c '!\[\[' "$f" 2>/dev/null || echo 0)
    EXT_IMG_COUNT=$(grep -c '!\[](http' "$f" 2>/dev/null || echo 0)
    TITLE=$(head -1 "$f" 2>/dev/null)

    echo ""
    echo "  📄 $BASENAME"
    echo "     大小: ${SIZE}B, 本地图: $IMG_COUNT, 外链图: $EXT_IMG_COUNT"

    # 判断是否有问题
    if [ "$BASENAME" = "Untitled.md" ]; then
        echo "     ⚠️  标题为 Untitled（内容提取可能失败）"
    fi
    if [ "$SIZE" -lt 500 ] 2>/dev/null; then
        echo "     ⚠️  文件过小（可能为反爬页面）"
    fi
done

# 检查队列
echo ""
echo "--- 队列状态 / Queue status ---"
REMAINING=$(python3 -c "import json; d=json.load(open('$QUEUE_FILE')); print(len(d))" 2>/dev/null || echo "?")
ERRORS=$(python3 -c "import json; d=json.load(open('$QUEUE_FILE')); print(sum(1 for e in d if e.get('status')=='error'))" 2>/dev/null || echo "?")
echo "  剩余条目: $REMAINING, 错误: $ERRORS"

if [ "$ERRORS" -gt 0 ] 2>/dev/null; then
    echo "  错误详情:"
    python3 -c "
import json
d = json.load(open('$QUEUE_FILE'))
for e in d:
    if e.get('status') == 'error':
        print(f'    {e[\"id\"]}: {e.get(\"error\", \"unknown\")[:100]}')
" 2>/dev/null
fi

echo ""
echo "=========================================="
echo "  测试完成 / Test complete"
echo "=========================================="
