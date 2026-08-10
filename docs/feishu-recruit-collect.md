# 飞书招聘简历采集工作流（招聘端）

把飞书招聘「待筛选」列表中的候选人导入 AptMatch 招聘端，并自动派发筛选任务。

## 一键启动（推荐）

在「招聘端 → 候选人库 → 开始采集」卡片中选择目标职位，点击「打开飞书招聘，开始采集」：

1. 前端调用 `POST /api/candidates/collect-start` 创建 `mode='collect'` 采集任务（同一职位只允许一个进行中的任务）。
2. 任务队列优先调度采集任务，后端 runner 以本机 `codex` CLI 启动 agent，prompt 指示使用 `feishu-recruit-collect` skill
   （`~/.codex/skills/feishu-recruit-collect/`）执行采集：检查 `/tmp/feishu_cookies.txt` → 运行
   `scripts/feishu-collect.mjs --import --position-id <id>` → 把汇总写入 `output/collect_result.json`。
3. 前端轮询任务状态并展示（排队中/运行中/已完成/失败）；采集导入成功后候选人自动进入 fit 筛选队列。
4. 采集由 agent 在后台完成，页面不再打开飞书；前提是 `/tmp/feishu_cookies.txt` 已存在且未过期
   （失效时任务会失败并提示重新复制 Cookie）。

## 前置条件

- AptMatch 服务已在运行（`npm run dev` 或 `npm start`，默认 http://127.0.0.1:8787）。
- 招聘端页面已创建目标职位（「招聘端 → 职位与 JD」），JD 可粘贴文本，或配置飞书文档链接由本地 `lark-cli` 读取。
- 本机已登录 codex CLI（`codex login status` 显示已登录），且存在会话 Cookie 文件 `/tmp/feishu_cookies.txt`
  （登录飞书招聘后从 DevTools 复制请求 Cookie 头保存）。

## 采集步骤（Codex 执行）

1. **确认当前页**：读取内置浏览器当前页面，确认是目标职位的「待筛选」候选人列表（记录职位名与页面 URL）。
2. **逐个采集候选人**：依次打开候选人详情页，提取简历可见文本与页面 URL；翻页继续，直到该职位列表处理完。
   - 只取可见文本，不强制下载附件 PDF；若详情页无有效文本，记录并跳过。
   - 同一职位下相同来源链接视为同一候选人，重复采集时跳过。
3. **导入**：对每个采集到的候选人调用

   ```http
   POST /api/candidates/import-feishu
   Content-Type: application/json

   {
     "position_id": "<职位 id>",
     "candidates": [
       { "name": "候选人姓名", "text": "简历可见文本", "source_url": "飞书简历页 URL" }
     ]
   }
   ```

   接口会去重、写入候选人库，并自动为每位候选人 × 该职位派发 fit 筛选任务（agent 默认取首个启用者）。
4. **回报**：汇总导入数量、跳过数量、已派发任务数；提示用户在「招聘端 → 候选人库」查看评分并按需标记 通过/待定/淘汰。

## 失败与重试

- 单份简历打开失败：记录原因，继续处理下一份；结束时汇总失败清单，可重试导入该候选人。
- 导入接口报错：按错误信息修正（职位不存在 / 超过单次 100 条上限 / agent 未启用），拆分批次重试。
- 登录失效：提示用户在内置浏览器重新登录飞书招聘，登录后从当前列表页继续。

## 高效批量采集（推荐，API 方案）

内置浏览器的 `playwright.evaluate` 运行在**只读隔离世界**（`fetch`/`XMLHttpRequest`/`eval`/`Function`/`document.createElement` 均不可用），无法注入 JS 到页面主上下文；内置浏览器也不暴露远程调试端口。因此**不要在页面里注入脚本**。

改用**独立 Playwright + 会话 Cookie** 调飞书招聘同源 API（毫秒级批量拉取）：

1. 从浏览器 DevTools 复制当前会话的 `Cookie` 头（含 `session`、`passport_app_access_token`、`msToken` 等）。
2. 用本地 Playwright（`createRequire("<带 playwright 的项目>/")`）启动 headless Chromium，`context.addCookies()` 注入 Cookie（domain `.feishu.cn`），先 `goto` 任意飞书页建立同源。
3. 在 `page.evaluate`（**主 realm**，fetch 可用）里调三个 API：

   ```js
   // 1) 待评估列表（分页：offset 0/20/40...，总数在 data.count）
   POST /atsx/api/evaluation/list_v2/
   body: {"q":"","filters":"{}","activity_status":0,"offset":0,"limit":20}
   // 2) 简历附件 ID（application_id 从列表项获取）
   GET /atsx/api/application/get_default_resume/?talent_id=<talent_id>&application_id=<application_id>
   // 3) 简历解析全文（parsed_content 为 JSON 字符串）
   GET /atsx/api/application/get_attachment_resume_text_ext/?talent_id=<talent_id>&attachment_resume_id=<attachment_resume_id>
   ```

4. 将 `parsed_content` 转成可读 Markdown（教育/工作/实习/项目/技能/自我评价/原文），构造 `import-feishu` 载荷导入（单次 ≤100 条）。
5. 无附件简历的候选人：`get_default_resume` 返回 `default_attachment: null`，仅保留基本信息并标记无简历。

注意：Cookie 有有效期（`msToken`/`session` 会过期）；页面详情页 URL 需带 `sharer_id=6914824184074208782` 才能直接打开（否则白屏）。
