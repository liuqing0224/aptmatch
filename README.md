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

```bash
npm test
npm run build
```

## 数据迁移

`scripts/split-project-data.mjs` 可从本地迁移备份重新生成两份隔离数据：

```bash
npm run split:data
```

该命令会重建 `jobseeker/.data/` 和 `recruiter/.data/`，仅用于迁移或需要从旧库重置时。

## 迁移备份

原单体项目已移入本地 `.migration-backup/legacy-tree/`，并生成了经过可读性校验的 `aptmatch-monolith-before-split-20260809.tgz`。该目录被 Git 忽略，仅用于本地回滚；日常开发只修改 `jobseeker/` 或 `recruiter/`。
