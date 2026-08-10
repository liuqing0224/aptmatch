---
name: feishu-recruit-playwright
description: Use a standalone Playwright Chromium session to collect resumes from Feishu Hire and import them into the AptMatch recruiter project by position. Use when asked to collect, synchronize, or import Feishu Hire candidates without the Codex in-app browser, especially when login may require waiting for the user to scan a QR code.
---

# Feishu Recruit Playwright

Collect candidates through a visible, persistent Chromium profile. Obtain the recruitment list only by intercepting `list_v2` responses naturally emitted by the Feishu page. Never request, copy, print, or store raw Cookie headers.

## Run The Workflow

1. Confirm that the recruiter API is running and obtain the target AptMatch `position_id` and exact position name.
2. Run `scripts/collect.mjs` with `--position-id`, `--job-name`, `--import`, and `--result-file`.
3. Detect the current page before declaring that login is required. If the persistent profile is already authenticated, enter the evaluation list immediately without a login wait. Only wait for a QR scan when the script prints `LOGIN_REQUIRED` (the current URL is a Feishu login or SSO page); when the script prints `已登录`, proceed directly and never pause for login.
   Keep login and SSO pages stable while the QR code is visible. After authentication leaves the login page, return to the evaluation-list URL automatically until the page emits `list_v2`.
4. Read the JSON result file. Report imported, skipped, dispatched, and unmatched counts.

```bash
node <skill-dir>/scripts/collect.mjs \
  --position-id <aptmatch-position-id> \
  --job-name "<exact-feishu-job-name>" \
  --api-base http://127.0.0.1:8887 \
  --import \
  --result-file <workspace>/output/collect_result.json
```

## Safety And Isolation

- Treat Feishu as read-only. Do not move stages, add comments, or mutate candidates.
- Keep the persistent login profile under `recruiter/.data/feishu-playwright-profile` by default.
- Filter by the target job before fetching resumes. Do not import candidates from another job when no matching Feishu job is found.
- Allow the same resume to be imported under different AptMatch positions. Server-side deduplication applies only within one position.
- Keep the visible browser independent from the Codex in-app browser.
- Register the Playwright response listener before navigation. Do not call the recruitment-list endpoint with `page.evaluate(fetch(...))` or another direct HTTP client.

## Options

Use `--limit <n>` for a bounded run, `--offset <n>` to resume, `--profile-dir <dir>` for another isolated account, and `--login-timeout <seconds>` to adjust QR wait time. Run `node scripts/collect.mjs --help` for all options.

Read [references/feishu-api.md](references/feishu-api.md) only when diagnosing endpoint or response-shape changes.
