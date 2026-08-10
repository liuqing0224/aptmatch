# AptMatch 双项目仓库

当前仓库包含两个物理隔离的完整全栈项目：

| 项目 | 目录 | Web | API | 数据 | Agent |
| --- | --- | --- | --- | --- | --- |
| 求职端 | `jobseeker/` | http://127.0.0.1:5173 | http://127.0.0.1:8787 | `jobseeker/.data/` | `jobseeker/agents/` |
| 招聘端 | `recruiter/` | http://127.0.0.1:5273 | http://127.0.0.1:8887 | `recruiter/.data/` | `recruiter/agents/` |

两个项目各自包含 `web` 前端、`server` 后端、SQLite 数据库、任务工作目录、日志、上传文件、Agent 档案与技能文件。任何新任务、设置修改或技能沉淀都只会写入当前项目。

## 快速启动

```bash
# 同时启动两个项目
npm run dev

# 只启动其中一个
npm run dev:jobseeker
npm run dev:recruiter
```

首次独立安装：

```bash
npm --prefix jobseeker install
npm --prefix recruiter install
```

## 验证

1. 「简历与公司」：粘贴或上传简历（PDF/DOCX/TXT），添加目标公司与 JD（可填官网链接供调研）。
2. 「新建匹配」-「批量爬取并匹配」：填关键词、城市、数量，agent 自动从 BOSS 直聘职位详情页 / 公司官网等公开来源抓取真实 JD；完成后在报告页可按**薪资区间 / 城市 / 简历匹配分**智能预筛，一键勾选通过的结果导入公司库并批量派发契合度分析。
3. 「新建匹配」-「单个匹配」：选择简历与 agent（目标公司可选）。选了公司 → 直接契合度分析；没选公司 → 系统按简历「求职意向」自动抓取相关岗位，勾选导入后再批量匹配，适合还没有目标公司的求职者。
4. 「看板」：任务排队 → 本地 agent 运行 → 产出报告；失败可看日志，完成可追问、可重跑。
5. 「报告」：总分与等级、十维加权雷达（硬技能 / 经验与行业 / 岗位职责 / 硬性门槛 / 技术方向 / 薪资与职级 / 文化价值观与工作强度 / 稳定性与成长 / 公司经营风险 / 个人偏好）、匹配要点、差距与弥补、面试问题、调研来源；可导出 Markdown 或 **PDF**；面试题旁可一键**开始模拟面试**——agent 扮演面试官围绕报告面试题与差距项逐轮提问、点评回答并给出整体评估。
6. 「对比」：同一份简历对多家公司的得分横向对比，支持**表格 / 热力图**两种视图；点「趋势」查看**同公司历史分数走势**，可**导出对比 PDF**。
7. 「Agent 管理」：新建 agent、编辑档案（`AGENTS.md`）、查看/编辑技能沉淀。
8. 「黑名单」：企业黑名单榜单，数据从 GitHub 上的社区黑名单仓库自动同步（默认源 `it-job-blacklist/996ICU.job.blacklist_company`，可在页面增删来源仓库）。可搜索公司/城市；报告页会按公司名自动模糊匹配并在命中时显示求职警示条；名单仅作面试前参考，需自行核实。

## 工作原理

- **调度**：`server/lib/runner.js` 为每个任务建立独立工作区（`.data/jobs/<taskId>/`），写入 `input/resume.md`、`input/jd.md`、`input/company.md`、`AGENTS.md`（agent 档案）与 `skills/`，然后按 provider 调用本地 CLI 非交互运行；agent 必须把报告写入 `output/report.json`。
- **采集**：`crawl` 模式任务由 `server/lib/crawl.js` 注入采集员角色（`CRAWL_AGENTS_MD`），agent 联网采集真实岗位 JD 并写入 `output/crawl_results.json`；`server/routes/crawl.js` 提供「创建采集任务」「导入结果并批量派发」与「按薪资/城市/匹配分智能预筛」三个接口。
- **模拟面试**：`interview` 模式由 `server/lib/interview.js` 注入面试官角色（`INTERVIEW_AGENTS_MD`），每轮一个任务以 `parent_task_id` 串成链；runner 回溯链路生成 `input/interview_history.md` 保持对话上下文，agent 逐轮输出 interview_turn schema（提问/点评/提示/是否结束）。
- **Provider 适配**：启动时扫描 PATH（及 `~/.local/bin`、`~/.codex/bin`、`~/.opencode/bin` 等常见位置）发现本机已安装的 coding agent CLI，按 codex → cursor → claude → opencode 顺序把第一个可用者作为默认 Provider（设置页可手动切换/重新扫描）；`codex exec --json -s danger-full-access`；`cursor agent -p --force`；`claude -p --dangerously-skip-permissions`；`opencode run --auto`。模型可在 agent 档案中配置。
- **报告契约**：后端 `server/lib/validate.js` 严格校验 `report.json` 的 schema（总分 0-100、S/A/B/C/D、十维且权重之和为 100、差距、面试问题、调研来源等），非法报告判为任务失败。
- **技能沉淀**：任务完成后，`report.learnings` 自动追加到该 agent 的 `skills/learnings.md`；后续任务会把全部技能文件注入工作区。
- **重启恢复**：服务重启后 `running` 任务自动回到 `queued` 重新入队。
- **数据本地**：SQLite（`.data/app.db`）、上传文件、任务工作区与日志全部在本机 `.data/` 目录。
- **黑名单同步**：`server/lib/blacklist.js` 按来源仓库拉取 Markdown 表格（兼容 `| a | b |` 与无前导管道两种格式），优先用已登录的 `gh` CLI（限额高），失败时回退匿名 GitHub API；解析幂等 upsert，来源可启停/删除，同步失败不阻塞主流程。

`scripts/split-project-data.mjs` 可从本地迁移备份重新生成两份隔离数据：

```bash
npm run split:data
```

该命令会重建 `jobseeker/.data/` 和 `recruiter/.data/`，仅用于迁移或需要从旧库重置时。

## 迁移备份

原单体项目已移入本地 `.migration-backup/legacy-tree/`，并生成了经过可读性校验的 `aptmatch-monolith-before-split-20260809.tgz`。该目录被 Git 忽略，仅用于本地回滚；日常开发只修改 `jobseeker/` 或 `recruiter/`。
