/** Timestamps arrive as UTC ISO strings; the user thinks in local time. */
export function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `сегодня ${time}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `вчера ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${time}`;
}

export function ago(ms: number | null): string {
  if (ms == null) return 'нет данных';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}

/** Russian noun agreement — "1 ссылка", "2 ссылки", "5 ссылок". */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
