import type { Graph } from '@cloudcanvas/compiler';

export interface Project {
  id: string;
  name: string; // display name
  description: string;
  createdAt: number;
  updatedAt: number;
  graph: Graph;
}

/** Async on purpose: swapping localStorage for a real API/database later only touches this file. */
export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  save(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = 'cc-projects-v1';

function read(): Project[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(ps: Project[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ps));
  } catch (e) {
    console.error('Could not save projects (storage full or blocked)', e);
  }
}

export const repo: ProjectRepository = {
  async list() {
    return read().sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id) {
    return read().find((p) => p.id === id);
  },
  async save(p) {
    const all = read().filter((x) => x.id !== p.id);
    write([...all, { ...p, updatedAt: Date.now() }]);
  },
  async remove(id) {
    write(read().filter((p) => p.id !== id));
  },
};

export const newId = () => 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** "Member Portal!" -> "member-portal" (valid Terraform/AWS name prefix) */
export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');

export function ago(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString();
}
