import { create } from 'zustand';
import { api } from './api';
import type { Agent, Company, Resume, Task } from './types';

interface TaskState {
  tasks: Task[];
  loaded: boolean;
  refresh: () => Promise<void>;
  upsert: (task: Task) => void;
}

export const useTaskStore = create<TaskState>()((set) => ({
  tasks: [],
  loaded: false,
  refresh: async () => {
    const list = await api.tasks.list();
    set({ tasks: list, loaded: true });
  },
  upsert: (task) =>
    set((state) => {
      const exists = state.tasks.some((t) => t.id === task.id);
      const tasks = exists
        ? state.tasks.map((t) => (t.id === task.id ? task : t))
        : [task, ...state.tasks];
      return {
        tasks: tasks.sort((a, b) => b.created_at.localeCompare(a.created_at)),
        loaded: true,
      };
    }),
}));

type ResourceKind = 'resumes' | 'companies' | 'agents';

interface ResourceState {
  resumes: Resume[];
  companies: Company[];
  agents: Agent[];
  loaded: { resumes: boolean; companies: boolean; agents: boolean };
  ensureLoaded: (kinds?: ResourceKind[]) => Promise<void>;
  refresh: (kinds?: ResourceKind[]) => Promise<void>;
  invalidate: (kind: ResourceKind) => void;
  addResume: (r: Resume) => void;
  removeResume: (id: string) => Promise<void>;
  addCompany: (c: Company) => void;
  removeCompany: (id: string) => Promise<void>;
  addAgent: (a: Agent) => void;
  updateAgent: (a: Agent) => void;
  removeAgent: (id: string) => Promise<void>;
}

const inFlight = new Map<string, Promise<void>>();

const fetchKind = async (kind: ResourceKind, set: (partial: Partial<ResourceState>) => void) => {
  const running = inFlight.get(kind);
  if (running) return running;
  const p = (async () => {
    if (kind === 'resumes') set({ resumes: await api.resumes.list() });
    else if (kind === 'companies') set({ companies: await api.companies.list() });
    else set({ agents: await api.agents.list() });
  })().finally(() => inFlight.delete(kind));
  inFlight.set(kind, p);
  return p;
};

export const useResourceStore = create<ResourceState>()((set, get) => ({
  resumes: [],
  companies: [],
  agents: [],
  loaded: { resumes: false, companies: false, agents: false },
  ensureLoaded: async (kinds) => {
    const targets = kinds ?? ['resumes', 'companies', 'agents'];
    const missing = targets.filter((k) => !get().loaded[k]);
    if (missing.length === 0) return;
    await Promise.all(missing.map((k) => fetchKind(k, set)));
    set((state) => {
      const next = { ...state.loaded };
      for (const k of missing) next[k] = true;
      return { loaded: next };
    });
  },
  refresh: async (kinds) => {
    const targets = kinds ?? ['resumes', 'companies', 'agents'];
    await Promise.all(targets.map((k) => fetchKind(k, set)));
    set((state) => {
      const next = { ...state.loaded };
      for (const k of targets) next[k] = true;
      return { loaded: next };
    });
  },
  invalidate: (kind) =>
    set((state) => ({ loaded: { ...state.loaded, [kind]: false } })),
  addResume: (r) => set((state) => ({ resumes: [r, ...state.resumes] })),
  removeResume: async (id) => {
    await api.resumes.remove(id);
    set((state) => ({ resumes: state.resumes.filter((x) => x.id !== id) }));
  },
  addCompany: (c) => set((state) => ({ companies: [c, ...state.companies] })),
  removeCompany: async (id) => {
    await api.companies.remove(id);
    set((state) => ({ companies: state.companies.filter((x) => x.id !== id) }));
  },
  addAgent: (a) =>
    set((state) => ({
      agents: [...state.agents, a].sort((x, y) => x.created_at.localeCompare(y.created_at)),
    })),
  updateAgent: (a) =>
    set((state) => ({ agents: state.agents.map((x) => (x.id === a.id ? a : x)) })),
  removeAgent: async (id) => {
    await api.agents.remove(id);
    set((state) => ({ agents: state.agents.filter((x) => x.id !== id) }));
  },
}));
