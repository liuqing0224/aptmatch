export interface Agent {
  id: string;
  name: string;
  slug: string;
  role: string;
  provider: 'codex' | 'cursor' | 'claude' | string;
  model: string;
  status: 'active' | 'paused' | string;
  created_at: string;
  updated_at: string;
}

export interface Resume {
  id: string;
  name: string;
  text: string;
  source_file: string;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  industry: string;
  stage: string;
  url: string;
  jd_text: string;
  source_file: string;
  kind: string;
  created_at: string;
}

export type CandidateStatus = '待筛' | '已筛' | '通过' | '待定' | '淘汰' | string;

export interface Candidate {
  id: string;
  resume_id: string;
  position_id: string;
  source_url: string;
  status: CandidateStatus;
  overall_score: number | null;
  grade: string;
  summary: string;
  note: string;
  created_at: string;
  updated_at: string;
  resume_name: string;
  position_name: string;
  analysis_task_id?: string | null;
  analysis_task_status?: TaskStatus | null;
}

export interface Dimension {
  key: string;
  label: string;
  score: number;
  weight?: number;
  reason: string;
  evidence: string[];
}

export interface FitReport {
  schema_version: number;
  summary: string;
  overall_score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | string;
  dimensions: Dimension[];
  matched: string[];
  gaps: { item: string; severity: 'high' | 'medium' | 'low' | string; mitigation: string }[];
  strengths: string[];
  risks: string[];
  questions: { question: string; why: string }[];
  suggestions: string[];
  research: { source: string; url: string; finding: string }[];
  learnings: string[];
}

export interface CrawlItem {
  company_name: string;
  position_title: string;
  salary: string;
  location: string;
  industry: string;
  stage: string;
  company_url: string;
  jd_text: string;
  source: string;
  source_url: string;
}

export interface CrawlResults {
  schema_version: number;
  keyword: string;
  city: string;
  generated_at: string;
  results: CrawlItem[];
  learnings: string[];
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  mode: string;
  parent_task_id: string | null;
  extra_prompt: string;
  status: TaskStatus;
  result: FitReport | CrawlResults | null;
  error: string;
  pid: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  agent: Agent | null;
  resume: Resume | null;
  company: Company | null;
}

export interface MatchRow {
  task_id: string;
  title: string;
  resume_name: string;
  company_id: string | null;
  company_name: string;
  overall_score: number;
  grade: string;
  summary: string;
  dimensions: Record<string, { label: string; score: number }>;
  created_at: string;
}

export interface BlacklistSource {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  enabled: boolean;
  entry_count: number;
  last_synced_at: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface BlacklistEntry {
  id: string;
  source_id: string;
  company_name: string;
  industry: string;
  city: string;
  address: string;
  issue: string;
  detail: string;
  source_url: string;
  added_at: string;
  source_name: string;
  owner: string;
  repo: string;
  branch: string;
  match_score?: number;
}

export interface BlacklistOverview {
  sources: BlacklistSource[];
  entries: BlacklistEntry[];
  total: number;
  syncing: string[];
  q: string;
  city: string;
}

export interface Settings {
  defaultProvider: string;
  concurrency: number;
  timeoutMinutes: number;
  dataDir: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  cmd: string | null;
  version: string | null;
}
