# Obsidian Share to Save 插件核心功能

| `name` | `"Share to Save"` |
| -------- | ------------------- |
| `id`   | `"share-to-save"` |

## Work flow

### V1版本：

暂时先不考虑手机端插件的单独使用，只在电脑端插件上获取URL内容。需要用户在手机和电脑Obsidian上都安装该插件来完成完整流程。
手机和电脑上安装的是同一个插件，但是功能不同。

#### 分享并保存

1. 手机端：用户在其他应用分享URL到Obsidian，比如微信分享公众号文章的URL到Obsidian，唤起Obsidian的分享的半浮层后，增加一个选项，把’保存到Share to Save'菜单插入到半浮层的‘在日记中插入文本’下方。
2. 点击‘保存到Share to Save’后，把URL该插件的安装目录下的一个文件内，比如tobesave.json（具体用json还是什么格式，你来评估下)。（这里注意，后期可能会引入让用户修改该文件保存到哪个目录的配置功能。需要考虑扩展性。）
   1. 另外，如果用户分享过来的是一段话，比如小红书复制链接，内容为

```
太无力了 每次看它自己读取不了docx和pdf，又要下Pyth... http://xhslink.com/o/2hUZDV3FB6M 
复制一下这行字，然后打开【小红书】看笔记。
```

需要能够提取内容中的URL，过滤掉其他文字内容。

3. 需要考虑这个文件可能积累很多URL，每次用户分享后，需要能够区分，别出现URL+URL连在一起，导致无法识别。考虑每次接收到URL后，结构化的存储。比如标记来源（手机还是电脑，添加时间，URL地址，等需要的信息)
4. 这个文件会被同步到电脑端，同步方案由用户自行选择，我们不需要考虑。
5. 电脑端的Share to Save监测同位置的文件，比如插件安装目录下的tobesave.json，当有新内容时，来提取里面的URL的内容，并保存到本地。这里要考虑，同步工具（比如/Users/admin/Docs/Project/fns/obsidian-fast-note-sync)时会不会存在分片下载的问题，需要等待结构完整后，再开始
6. 下载的内容，保存到Obsidian的指定文件夹下，默认文件夹为StS，用户可在插件设置中修改该文件夹名称
7. 文章图片/附件都保存到本地。
8. 下载完成后，把tobesave.json中已处理完成的URL删掉。

#### 直接输入URL

电脑端和手机端，都在ribbon按钮中增加一个Button点击后，展示一个输入窗口，用户可以直接粘贴内容进来，从内容中提取URL，并执行上述流程。

但是需要考虑：

手机端与上面的分享流程相同。

但是电脑端直接输入URL后，是否还有必要向tobesave.json写入内容后再进行流程，还是直接获取URL内容？但如果不一致，意味着同一个插件在手机和电脑上的流程机制不相同，需要维护两份代码。请你权衡，给出优劣，我们讨论。

输入网址的交互逻辑，可以参考这几个项目

/Users/admin/Docs/Project/anycontent-obsidian-importer

/Users/admin/Docs/Project/xiaohongshu-importer

但我们本期先不增加选择类别，和选择是否保存到本地，我们本期默认都是同一个文件夹，并且都默认保存到本地。

另外，如果一次输入多个URL这个功能，实现起来很复杂，我们本期可以不做。请你做个分析，给我一个反馈。

#### URL下载方法：

核心参考 ‘/Users/admin/Docs/Project/ima-copilot-sync’的实现

1. 由于我们的插件只在电脑端处理下载，所以不需要像ima-copilot-sync插件那样使用requestURL来尝试一下。可以直接用node.js https.
2. 但是注意，我们的插件不是isDesktopOnly的，因为需要手机端安装来接收URL
3. 是否需要参考ima-copilot-sync使用dufuddle，还是我们完全自己实现，请你分析下，列出优缺点，给出反馈，
4. 图片和附件的保存位置固定为 文件夹下的attachments文件夹，比如Sts/attachments
5. 图片和附件的重命名方法与ima-copilot-sync相同
6. 文件内使用最简单的[[attachment-title]]方式来引用图片和附件，由Obsidian来管理附件路径，我们不需要再处理路径的引用，这样可以更简单。并且不在配置中提供选择。

#### 保存后的文件内容格式

参考ima-copilot-sync，在frontmatter里使用

source: 就是要提取的URL

author：作者+作者URL（需要我们自己修改后的dufuddle才能获取authorURL:/Users/admin/Docs/Project/defuddle)

created:日期时间格式，文档创建时间

published:文章发布日期时间，如无则留空（ima没有获取，但是dufuddle可以获取)

以及，是否需要增加本插件用来做内部管理的的新字段？
