# 测试 Fixtures

端到端测试的 HTML 输入 → Markdown 输出配对。

## 结构

```
fixtures/
├── html/          # 原始 HTML（gitignore，太大不提交）
│   ├── op_html-elements.html    # Obsidian Publish SPA shell
│   ├── op_icons.html            # Obsidian Publish SPA shell
│   ├── wechat_dataview.html     # 微信公众号文章
│   ├── wechat_huangrenxun.html  # 微信公众号文章
│   ├── wechat_ob-search.html    # 微信公众号文章
│   ├── wechat_short.html        # 微信公众号短文章
│   └── xhs_ai-cloud.html        # 小红书笔记
├── expected/      # 期望输出的 Markdown（提交到 git）
│   ├── op_html-elements.md
│   ├── op_icons.md
│   ├── wechat_dataview.md
│   ├── wechat_huangrenxun.md
│   ├── wechat_ob-search.md
│   ├── xhs_ai-cloud.md
│   └── zhihu_bmw.md            # 无对应 HTML（知乎 403）
└── README.md
```

## 抓取 HTML

通过 AgentCloak MCP 抓取页面 HTML 保存到 `html/` 目录：

```bash
# 在 Claude Code 中使用 agentcloak MCP 的 download 工具
# agentcloak_download action=url url=<page_url> output_dir=tests/fixtures/html
```

## 使用

修改 converter 后，用 fixtures 做手工回归对比：

1. 确保 `html/` 下有对应的 HTML 文件
2. 运行插件处理 HTML，对比输出与 `expected/` 中的参考 Markdown
3. 后续可编写快照测试：`HTML 输入 → 转换管线 → 对比 expected/*.md`

## 维护

新增平台或修改转换器时，补充对应的 fixtures 配对。
