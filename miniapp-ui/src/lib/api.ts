import { initData } from './telegram';

export interface TaskView {
  id: string;
  title: string;
  nextRun: string | null;
  scheduleType: string;
  kind: string;
  status: string;
  derived: boolean;
}

export interface LinkView {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  domain: string | null;
  tags: string[];
  note: string | null;
  read: boolean;
  addedAt: string;
}

export interface MessageView {
  at: string;
  fromBot: boolean;
  text: string;
}

export interface Rule {
  text: string;
  learnedAt: string;
}

export interface InstalledSkill {
  name: string;
  description: string;
}

export interface ProposalView {
  name: string;
  description: string;
  replaces: boolean;
  content: string;
}

export interface TurnTrace {
  skills: string[];
  tools: Record<string, number>;
  rules: number;
  startedAt: string;
  durationMs: number;
}

export interface Brain {
  rules: Rule[];
  skills: InstalledSkill[];
  proposals: ProposalView[];
  turns: TurnTrace[];
}

export interface DayStats {
  day: string;
  meetings: number;
  meetingMinutes: number;
  linksSaved: number;
  linksRead: number;
  notesTouched: number;
  messagesFromUser: number;
  messagesFromBot: number;
  tasksRun: number;
}

export interface Overview {
  linkCount: number;
  unreadLinkCount: number;
  taskCount: number;
  upcoming: TaskView[];
  lastRefreshAgeMs: number | null;
  generatedAt: string;
}

/**
 * Every request carries `initData`; the server re-verifies it each time. There
 * is no session to establish, so a failure is always about this request and
 * never about state the client is holding.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    ...init,
    headers: {
      'X-Telegram-Init-Data': initData(),
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (res.status === 401) throw new Error('Нет доступа');
  if (!res.ok) throw new Error(`Ошибка ${res.status}`);
  return (await res.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export type LinkFilter = 'unread' | 'read' | 'all';

export const api = {
  overview: () => request<Overview>('overview'),

  tasks: () => request<{ tasks: TaskView[] }>('tasks'),
  deleteTask: (id: string) =>
    post<{ deleted: boolean; reason?: string }>('tasks/delete', { id }),

  links: (opts: { filter: LinkFilter; tag?: string; q?: string }) =>
    request<{ links: LinkView[]; tags: string[] }>(
      `links${query({ filter: opts.filter, tag: opts.tag, q: opts.q })}`,
    ),
  setLinkRead: (id: number, read: boolean) =>
    post<{ updated: boolean }>('links/read', { id, read }),
  updateLink: (id: number, fields: { tags?: string; note?: string }) =>
    post<{ updated: boolean }>('links/update', { id, ...fields }),
  deleteLink: (id: number) => post<{ deleted: boolean }>('links/delete', { id }),

  history: (q: string) =>
    request<{ messages: MessageView[]; assistantName: string }>(
      `history${query({ q })}`,
    ),

  send: (text: string) => post<{ sent: boolean; reason?: string }>('message', { text }),

  brain: () => request<Brain>('brain'),
  days: (n = 7) => request<{ days: DayStats[] }>(`days${query({ n: String(n) })}`),
  forgetRule: (text: string) => post<{ removed: boolean }>('rules/forget', { text }),
  installSkill: (name: string) =>
    post<{ installed: boolean; reason?: string }>('skills/install', { name }),
  discardSkill: (name: string) =>
    post<{ discarded: boolean }>('skills/discard', { name }),
};
