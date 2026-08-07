# AptMatch（适所）

> 取名自「適材適所」——对的人，到对的岗位。

面向求职者的本地 Web 应用：把「某份简历 × 某家公司/岗位的契合度分析」作为任务派发给本地 coding agent（codex 默认，可切换 cursor / claude）。agent 默认联网调研公司官网与公开信息，返回结构化评分报告；支持多 agent 档案、技能沉淀、任务看板与跨公司对比。

架构参考 [Multica](https://github.com/multica-ai/multica)：让本地编码 agent 像队友一样接任务、自主执行、回报结构化结果。

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>（后端在 <http://127.0.0.1:8787>）。

生产模式：

```bash
npm run build
npm start        # 打开 http://127.0.0.1:8787
```

## 使用流程

1. 「简历与公司」：粘贴或上传简历（PDF/DOCX/TXT），添加目标公司与 JD（可填官网链接供调研）。
2. 「新建匹配」-「批量爬取并匹配」：填关键词、城市、数量，agent 自动从 BOSS 直聘职位详情页 / 公司官网等公开来源抓取真实 JD；完成后在报告页勾选结果，一键导入公司库并批量派发契合度分析。
3. 「新建匹配」-「单个匹配」：选择简历与 agent（目标公司可选）。选了公司 → 直接契合度分析；没选公司 → 系统按简历「求职意向」自动抓取相关岗位，勾选导入后再批量匹配，适合还没有目标公司的求职者。
4. 「看板」：任务排队 → 本地 agent 运行 → 产出报告；失败可看日志，完成可追问、可重跑。
5. 「报告」：总分与等级、十维加权雷达（硬技能 / 经验与行业 / 岗位职责 / 硬性门槛 / 技术方向 / 薪资与职级 / 文化价值观与工作强度 / 稳定性与成长 / 公司经营风险 / 个人偏好）、匹配要点、差距与弥补、面试问题、调研来源；可导出 Markdown。
6. 「对比」：同一份简历对多家公司的得分横向对比。
7. 「Agent 管理」：新建 agent、编辑档案（`AGENTS.md`）、查看/编辑技能沉淀。
8. 「黑名单」：企业黑名单榜单，数据从 GitHub 上的社区黑名单仓库自动同步（默认源 `it-job-blacklist/996ICU.job.blacklist_company`，可在页面增删来源仓库）。可搜索公司/城市；报告页会按公司名自动模糊匹配并在命中时显示求职警示条；名单仅作面试前参考，需自行核实。

## 工作原理

- **调度**：`server/lib/runner.js` 为每个任务建立独立工作区（`.data/jobs/<taskId>/`），写入 `input/resume.md`、`input/jd.md`、`input/company.md`、`AGENTS.md`（agent 档案）与 `skills/`，然后按 provider 调用本地 CLI 非交互运行；agent 必须把报告写入 `output/report.json`。
- **采集**：`crawl` 模式任务由 `server/lib/crawl.js` 注入采集员角色（`CRAWL_AGENTS_MD`），agent 联网采集真实岗位 JD 并写入 `output/crawl_results.json`；`server/routes/crawl.js` 提供「创建采集任务」与「导入结果并批量派发」两个接口。
- **Provider 适配**：启动时扫描 PATH（及 `~/.local/bin`、`~/.codex/bin` 等常见位置）发现本机已安装的 coding agent CLI，按 codex → cursor → claude 顺序把第一个可用者作为默认 Provider（设置页可手动切换/重新扫描）；`codex exec --json -s danger-full-access`；`cursor agent -p --force`；`claude -p --dangerously-skip-permissions`。模型可在 agent 档案中配置。
- **报告契约**：后端 `server/lib/validate.js` 严格校验 `report.json` 的 schema（总分 0-100、S/A/B/C/D、十维且权重之和为 100、差距、面试问题、调研来源等），非法报告判为任务失败。
- **技能沉淀**：任务完成后，`report.learnings` 自动追加到该 agent 的 `skills/learnings.md`；后续任务会把全部技能文件注入工作区。
- **重启恢复**：服务重启后 `running` 任务自动回到 `queued` 重新入队。
- **数据本地**：SQLite（`.data/app.db`）、上传文件、任务工作区与日志全部在本机 `.data/` 目录。
- **黑名单同步**：`server/lib/blacklist.js` 按来源仓库拉取 Markdown 表格（兼容 `| a | b |` 与无前导管道两种格式），优先用已登录的 `gh` CLI（限额高），失败时回退匿名 GitHub API；解析幂等 upsert，来源可启停/删除，同步失败不阻塞主流程。

## 测试

```bash
npm test                     # 后端 + 前端全部测试
SMOKE_MOCK=1 node scripts/smoke.mjs   # mock runner 端到端冒烟
node scripts/smoke.mjs       # 真实 codex agent 端到端冒烟（需 codex CLI）
```

## 安全说明

- 仅监听 `127.0.0.1`，单用户、无鉴权；不要直接暴露到公网。
- 本地 coding agent 以当前用户权限执行命令，这是该类工具的固有设计；agent 可能读写本机文件、访问网络。建议只用可信机器运行。
- 数据不出本机；上传文件与报告原文均存储于 `.data/`。

## 目录结构

```text
server/    Express + better-sqlite3 API、任务调度、provider 适配、报告校验
web/       Vite + React + TS 看板前端
agents/    agent 档案（AGENTS.md）与技能沉淀
scripts/   端到端冒烟测试
.data/     运行时数据（不入库）
```
