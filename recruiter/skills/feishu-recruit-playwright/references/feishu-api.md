# Feishu Hire Read-Only API Notes

The collector calls these endpoints from the authenticated Feishu page context:

- `POST /atsx/api/evaluation/list_v2/`: paginated evaluation list. Capture responses emitted by the visible Feishu page with Playwright `page.on('response')`; drive pagination through page scrolling or its next-page control. Never synthesize this request in collector code.
- `GET /atsx/api/application/get_default_resume/`: default attachment metadata.
- `GET /atsx/api/application/get_attachment_resume_text_ext/`: parsed resume content.

The APIs are not a stable public contract. If Feishu changes a response shape, inspect only the authenticated page network traffic and update the smallest parser surface. Never persist request headers, Cookie values, or authentication tokens in logs or Markdown.

The import target is `POST /api/candidates/import-feishu` on the independent recruiter API. Send batches of at most 100 with `{ position_id, candidates: [{ name, text, source_url }] }`.
