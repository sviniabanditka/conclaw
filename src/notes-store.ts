/**
 * Reading and writing the Obsidian vault from the host.
 *
 * Notes are markdown files with YAML frontmatter, and they are the one memory
 * the user owns — so the app edits them in place rather than keeping a copy.
 * The vault's own git daemon commits every couple of minutes, which is what
 * gives edits from here a history and an undo without this module having one.
 *
 * What it deliberately does not do is maintain `_MOC.md`. The index is the
 * `notes` skill's job and the librarian repairs drift weekly; a second
 * implementation here would be one more thing to disagree with the first,
 * which is the failure this codebase has hit more than once.
 */
import fs from 'fs';
import path from 'path';

/** Folders the vault declares for this assistant's notes. */
export const NOTE_FOLDERS = ['General', 'Sessions'] as const;
export const MAX_NOTE_BYTES = 256 * 1024;

export interface Note {
  /** Path relative to the notes root — `General/Domain.md`. Also the id. */
  id: string;
  title: string;
  body: string;
  tags: string[];
  type: string | null;
  created: string | null;
  updated: string | null;
}

/**
 * Resolve a note id to an absolute path, or null.
 *
 * The id comes from a URL, so it is treated as hostile: it must stay inside
 * the notes root and be a markdown file. Both checks, because either alone
 * lets something through — a name may escape without `..` via an absolute
 * path, and a path inside the root may still be something that is not a note.
 */
export function notePath(notesDir: string, id: string): string | null {
  if (!id || id.includes('\0')) return null;
  const root = path.resolve(notesDir);
  const full = path.resolve(root, id);
  if (!full.startsWith(root + path.sep)) return null;
  if (path.extname(full).toLowerCase() !== '.md') return null;
  return full;
}

export function parseFrontmatter(content: string): {
  fields: Record<string, string>;
  body: string;
} {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!m) return { fields: {}, body: content };
  const fields: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fields, body: content.slice(m[0].length) };
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Turn a file into a note.
 *
 * The heading is dropped from the body when it matches the title: it is shown
 * as the title in the app, and leaving it in means editing a note that opens
 * with its own name repeated.
 */
export function parseNote(id: string, content: string): Note {
  const { fields, body } = parseFrontmatter(content);
  const heading = /^#\s+(.+)$/m.exec(body);
  const title = heading?.[1]?.trim() || path.basename(id, '.md');
  const withoutHeading = heading
    ? body.replace(heading[0], '').replace(/^\n+/, '')
    : body.replace(/^\n+/, '');

  return {
    id,
    title,
    body: withoutHeading.trimEnd(),
    tags: parseTags(fields.tags),
    type: fields.type ?? null,
    created: fields.created ?? null,
    updated: fields.updated ?? null,
  };
}

export function renderNote(note: {
  title: string;
  body: string;
  tags: string[];
  type: string | null;
  created: string | null;
  updated: string;
}): string {
  const lines = ['---', `created: ${note.created ?? note.updated}`, `updated: ${note.updated}`];
  if (note.type) lines.push(`type: ${note.type}`);
  if (note.tags.length > 0) lines.push(`tags: [${note.tags.join(', ')}]`);
  lines.push('---', '', `# ${note.title}`, '');
  const body = note.body.trim();
  if (body) lines.push(body, '');
  return lines.join('\n');
}

/** Every note under the root, newest-updated first. */
export function listNotes(notesDir: string): Note[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(notesDir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }

  const notes: Note[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    // `_MOC.md` and `_index.md` are indexes the skill maintains, not notes.
    if (entry.name.startsWith('_')) continue;
    const parent = entry.parentPath ?? notesDir;
    const id = path.relative(notesDir, path.join(parent, entry.name));
    try {
      notes.push(parseNote(id, fs.readFileSync(path.join(parent, entry.name), 'utf-8')));
    } catch {
      // A file that cannot be read is one note missing, not an empty vault.
    }
  }
  return notes.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
}

export function readNote(notesDir: string, id: string): Note | null {
  const full = notePath(notesDir, id);
  if (!full) return null;
  try {
    return parseNote(id, fs.readFileSync(full, 'utf-8'));
  } catch {
    return null;
  }
}

export interface NoteInput {
  title: string;
  body: string;
  tags: string[];
  type?: string | null;
}

/** A filename from a title — Obsidian links by filename, so they must match. */
export function fileNameFor(title: string): string {
  return `${title.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 120)}.md`;
}

export interface SaveResult {
  saved: boolean;
  id?: string;
  reason?: string;
}

/**
 * Write a note, renaming the file when the title changed.
 *
 * Obsidian links by filename, so a note whose heading no longer matches its
 * file is one whose `[[links]]` point at a different name than it displays.
 */
export function saveNote(
  notesDir: string,
  id: string,
  input: NoteInput,
  now: string = new Date().toISOString(),
): SaveResult {
  const full = notePath(notesDir, id);
  if (!full) return { saved: false, reason: 'bad id' };
  const title = input.title.trim();
  if (!title) return { saved: false, reason: 'title is required' };

  const existing = readNote(notesDir, id);
  const content = renderNote({
    title,
    body: input.body,
    tags: input.tags,
    type: input.type ?? existing?.type ?? 'knowledge',
    created: existing?.created ?? now.slice(0, 10),
    updated: now.slice(0, 10),
  });
  if (Buffer.byteLength(content) > MAX_NOTE_BYTES) {
    return { saved: false, reason: 'note too large' };
  }

  const wantedName = fileNameFor(title);
  const target = path.join(path.dirname(full), wantedName);
  const targetId = path.relative(path.resolve(notesDir), target);

  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(target, content);
    if (target !== full && fs.existsSync(full)) fs.rmSync(full);
  } catch (err) {
    return {
      saved: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  return { saved: true, id: targetId };
}

export function createNote(
  notesDir: string,
  input: NoteInput,
  folder: string = NOTE_FOLDERS[0],
  now: string = new Date().toISOString(),
): SaveResult {
  const title = input.title.trim();
  if (!title) return { saved: false, reason: 'title is required' };
  if (!(NOTE_FOLDERS as readonly string[]).includes(folder)) {
    return { saved: false, reason: 'unknown folder' };
  }
  const id = path.join(folder, fileNameFor(title));
  const full = notePath(notesDir, id);
  if (!full) return { saved: false, reason: 'bad id' };
  if (fs.existsSync(full)) return { saved: false, reason: 'a note with that title exists' };

  fs.mkdirSync(path.dirname(full), { recursive: true });
  return saveNote(notesDir, id, input, now);
}

export function deleteNote(notesDir: string, id: string): boolean {
  const full = notePath(notesDir, id);
  if (!full || !fs.existsSync(full)) return false;
  fs.rmSync(full);
  return true;
}

/** Case-insensitive across title, body and tags — SQLite's rules do not apply here. */
export function searchNotes(notes: Note[], query: string, tag?: string): Note[] {
  let out = notes;
  const t = tag?.trim().toLocaleLowerCase();
  if (t) {
    out = out.filter((n) => n.tags.some((x) => x.toLocaleLowerCase() === t));
  }
  const q = query.trim().toLocaleLowerCase();
  if (q) {
    out = out.filter((n) =>
      [n.title, n.body, n.tags.join(' ')].some((f) =>
        f.toLocaleLowerCase().includes(q),
      ),
    );
  }
  return out;
}
