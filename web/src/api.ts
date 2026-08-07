import type {
  Agent,
  BlacklistEntry,
  BlacklistOverview,
  BlacklistSource,
  Company,
  MatchRow,
  ProviderInfo,
  Resume,
  Settings,
  Task,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  agents: {
    list: () => request<{ agents: Agent[] }>('/api/agents').then((r) => r.agents),
    create: (body: Partial<Agent>) =>
      request<{ agent: Agent }>('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.agent),
    update: (id: string, body: Partial<Agent>) =>
      request<{ agent: Agent }>(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.agent),
    remove: (id: string) => request<{ ok: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
    profile: (id: string) =>
      request<{ profile: string }>(`/api/agents/${id}/profile`).then((r) => r.profile),
    saveProfile: (id: string, profile: string) =>
      request<{ ok: boolean }>(`/api/agents/${id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      }),
    skills: (id: string) =>
      request<{ skills: { name: string; content: string }[] }>(`/api/agents/${id}/skills`).then(
        (r) => r.skills
      ),
    createSkill: (id: string, name: string, content: string) =>
      request<{ skill: { name: string; content: string } }>(`/api/agents/${id}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      }).then((r) => r.skill),
    saveSkill: (id: string, name: string, content: string) =>
      request<{ ok: boolean }>(`/api/agents/${id}/skills/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
  },
  resumes: {
    list: () => request<{ resumes: Resume[] }>('/api/resumes').then((r) => r.resumes),
    create: (form: FormData) =>
      request<{ resume: Resume }>('/api/resumes', { method: 'POST', body: form }).then(
        (r) => r.resume
      ),
    remove: (id: string) => request<{ ok: boolean }>(`/api/resumes/${id}`, { method: 'DELETE' }),
  },
  companies: {
    list: () => request<{ companies: Company[] }>('/api/companies').then((r) => r.companies),
    create: (form: FormData) =>
      request<{ company: Company }>('/api/companies', { method: 'POST', body: form }).then(
        (r) => r.company
      ),
    remove: (id: string) => request<{ ok: boolean }>(`/api/companies/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: () => request<{ tasks: Task[] }>('/api/tasks').then((r) => r.tasks),
    get: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`).then((r) => r.task),
    create: (body: {
      agent_id?: string;
      resume_id: string;
      company_id: string;
      mode?: string;
      extra_prompt?: string;
      parent_task_id?: string;
    }) =>
      request<{ task: Task }>('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.task),
    cancel: (id: string) =>
      request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
    rerun: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/rerun`, { method: 'POST' }),
    followup: (id: string, message: string) =>
      request<{ task: Task }>(`/api/tasks/${id}/followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      }).then((r) => r.task),
    log: (id: string) => request<{ log: string }>(`/api/tasks/${id}/log`).then((r) => r.log),
  },
  matches: {
    list: (resumeId?: string) =>
      request<{ matches: MatchRow[] }>(
        `/api/matches${resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ''}`
      ).then((r) => r.matches),
  },
  crawl: {
    create: (body: {
      keyword: string;
      city?: string;
      limit?: number;
      resume_id?: string;
      agent_id?: string;
    }) =>
      request<{ task: Task }>('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.task),
    import: (
      taskId: string,
      body: {
        resume_id?: string;
        agent_id?: string;
        indices?: number[];
        auto_dispatch?: boolean;
      }
    ) =>
      request<{ imported: { id: string; name: string }[]; dispatched: string[]; message: string }>(
        `/api/crawl/${taskId}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      ),
  },
  blacklist: {
    overview: (params?: { q?: string; city?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      if (params?.city) qs.set('city', params.city);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<BlacklistOverview>(`/api/blacklist${suffix}`);
    },
    check: (company: string) =>
      request<{ hits: BlacklistEntry[] }>(
        `/api/blacklist/check?company=${encodeURIComponent(company)}`
      ).then((r) => r.hits),
    sync: (sourceId?: string) =>
      request<{ started: number; syncing: string[] }>('/api/blacklist/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      }),
    addSource: (body: { name?: string; owner: string; repo: string; branch?: string }) =>
      request<{ source: BlacklistSource }>('/api/blacklist/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.source),
    updateSource: (id: string, body: Partial<BlacklistSource>) =>
      request<{ source: BlacklistSource }>(`/api/blacklist/sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.source),
    removeSource: (id: string) =>
      request<{ ok: boolean }>(`/api/blacklist/sources/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => request<{ settings: Settings }>('/api/settings').then((r) => r.settings),
    update: (body: Partial<Settings>) =>
      request<{ settings: Settings }>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.settings),
    providers: () =>
      request<{ providers: ProviderInfo[]; detected: string; default: string }>(
        '/api/settings/providers'
      ),
  },
};
