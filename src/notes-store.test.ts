/**
 * Editing the vault from the host.
 *
 * The note id travels in a URL, so half of this is about it not being able to
 * point outside the vault. The other half is the rename: Obsidian links by
 * filename, so a note whose heading stops matching its file is one whose
 * `[[links]]` quietly point somewhere else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  createNote,
  deleteNote,
  fileNameFor,
  listNotes,
  notePath,
  parseNote,
  readNote,
  renderNote,
  saveNote,
  searchNotes,
} from './notes-store.js';

let root: string;
let notesDir: string;

const NOTE = `---
created: 2026-07-01
updated: 2026-07-22
project: general
type: knowledge
tags: [knowledge, домен, infra]
---

# Domain sviniabanditka.com

Registrar is Namecheap.

## Details
- DNS at Cloudflare.
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  notesDir = path.join(root, 'conclaw');
  fs.mkdirSync(path.join(notesDir, 'General'), { recursive: true });
  // Filename matches the heading, as every real note in the vault does.
  fs.writeFileSync(path.join(notesDir, 'General', 'Domain sviniabanditka.com.md'), NOTE);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('notePath', () => {
  it('resolves a note inside the vault', () => {
    expect(notePath(notesDir, 'General/Domain.md')).toBe(
      path.join(notesDir, 'General', 'Domain.md'),
    );
  });

  it('refuses a name that is not markdown even inside the vault', () => {
    expect(notePath(notesDir, 'General/notes')).toBeNull();
  });

  // The id comes from a URL and is treated as hostile.
  it('refuses anything that leaves the vault', () => {
    for (const id of [
      '../secrets.md',
      '../../etc/passwd.md',
      '/etc/passwd.md',
      'General/../../x.md',
    ]) {
      expect(notePath(notesDir, id), id).toBeNull();
    }
  });

  it('refuses anything that is not markdown', () => {
    expect(notePath(notesDir, 'General/Domain.txt')).toBeNull();
    expect(notePath(notesDir, '')).toBeNull();
  });
});

describe('parseNote', () => {
  it('reads the frontmatter, the title and the body', () => {
    const note = parseNote('General/Domain.md', NOTE);
    expect(note.title).toBe('Domain sviniabanditka.com');
    expect(note.tags).toEqual(['knowledge', 'домен', 'infra']);
    expect(note.type).toBe('knowledge');
    expect(note.updated).toBe('2026-07-22');
    // The heading is shown as the title, so leaving it in the body would
    // repeat the name back at whoever opens the editor.
    expect(note.body).not.toMatch(/^#\s/);
    expect(note.body).toContain('Registrar is Namecheap.');
  });

  it('falls back to the filename when there is no heading', () => {
    const note = parseNote('General/No Heading.md', '---\nupdated: 2026-07-22\n---\n\nbody');
    expect(note.title).toBe('No Heading');
  });

  it('handles a file with no frontmatter at all', () => {
    const note = parseNote('General/Plain.md', '# Plain\n\nbody\n');
    expect(note.title).toBe('Plain');
    expect(note.tags).toEqual([]);
  });
});

describe('renderNote', () => {
  it('round-trips through parse', () => {
    const original = parseNote('General/Domain.md', NOTE);
    const rendered = renderNote({ ...original, updated: '2026-07-23' });
    const again = parseNote('General/Domain.md', rendered);
    expect(again.title).toBe(original.title);
    expect(again.tags).toEqual(original.tags);
    expect(again.body).toBe(original.body);
    expect(again.updated).toBe('2026-07-23');
  });

  it('keeps created as it was', () => {
    const rendered = renderNote({
      title: 'X',
      body: '',
      tags: [],
      type: 'knowledge',
      created: '2026-01-01',
      updated: '2026-07-22',
    });
    expect(rendered).toContain('created: 2026-01-01');
  });
});

describe('listNotes', () => {
  it('finds notes in subfolders, newest first', () => {
    fs.writeFileSync(
      path.join(notesDir, 'General', 'Older.md'),
      '---\nupdated: 2026-07-01\n---\n\n# Older\n',
    );
    const notes = listNotes(notesDir);
    expect(notes.map((n) => n.title)).toEqual(['Domain sviniabanditka.com', 'Older']);
  });

  // Indexes are the skill's to maintain, not notes.
  it('skips index files', () => {
    fs.writeFileSync(path.join(notesDir, '_MOC.md'), '---\nupdated: 2026-07-22\n---\n# MOC\n');
    expect(listNotes(notesDir).map((n) => n.title)).toEqual(['Domain sviniabanditka.com']);
  });

  it('is empty rather than failing when the vault is not there', () => {
    expect(listNotes(path.join(root, 'nope'))).toEqual([]);
  });
});

describe('saveNote', () => {
  it('writes the body and bumps updated', () => {
    const id = 'General/Domain sviniabanditka.com.md';
    const res = saveNote(
      notesDir,
      id,
      { title: 'Domain sviniabanditka.com', body: 'New body', tags: ['infra'] },
      '2026-08-01T10:00:00Z',
    );
    expect(res.saved).toBe(true);
    expect(res.id).toBe(path.join('General', 'Domain sviniabanditka.com.md'));
    const note = readNote(notesDir, res.id!)!;
    expect(note.body).toBe('New body');
    expect(note.updated).toBe('2026-08-01');
    expect(note.created).toBe('2026-07-01');
  });

  // Obsidian links by filename; a heading that no longer matches its file
  // means every [[link]] points at a name the note no longer shows.
  it('renames the file when the title changes', () => {
    const res = saveNote(notesDir, 'General/Domain sviniabanditka.com.md', {
      title: 'Domain and DNS',
      body: 'x',
      tags: [],
    });
    expect(res.id).toBe(path.join('General', 'Domain and DNS.md'));
    expect(fs.existsSync(path.join(notesDir, 'General', 'Domain and DNS.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(notesDir, 'General', 'Domain sviniabanditka.com.md')),
    ).toBe(false);
  });

  it('refuses an empty title and a hostile id', () => {
    expect(
      saveNote(notesDir, 'General/Domain sviniabanditka.com.md', {
        title: '  ',
        body: '',
        tags: [],
      }).saved,
    ).toBe(false);
    expect(saveNote(notesDir, '../evil.md', { title: 'X', body: '', tags: [] }).saved)
      .toBe(false);
    expect(fs.existsSync(path.join(root, 'evil.md'))).toBe(false);
  });
});

describe('createNote', () => {
  it('creates in the folder the vault declares', () => {
    const res = createNote(notesDir, { title: 'New thing', body: 'b', tags: ['x'] });
    expect(res.saved).toBe(true);
    expect(res.id).toBe(path.join('General', 'New thing.md'));
    expect(readNote(notesDir, res.id!)!.title).toBe('New thing');
  });

  it('refuses to silently overwrite an existing note', () => {
    const res = createNote(notesDir, {
      title: 'Domain sviniabanditka.com',
      body: '',
      tags: [],
    });
    expect(res.saved).toBe(false);
    expect(res.reason).toMatch(/exists/);
    expect(
      readNote(notesDir, 'General/Domain sviniabanditka.com.md')!.body,
    ).toContain('Namecheap');
  });

  it('refuses a folder the vault does not declare', () => {
    expect(createNote(notesDir, { title: 'X', body: '', tags: [] }, '../..').saved).toBe(false);
  });
});

describe('fileNameFor', () => {
  it('strips characters a filesystem will not take', () => {
    expect(fileNameFor('a/b:c?d')).toBe('a-b-c-d.md');
  });
});

describe('deleteNote', () => {
  it('deletes a note and refuses anything outside the vault', () => {
    const id = 'General/Domain sviniabanditka.com.md';
    expect(deleteNote(notesDir, id)).toBe(true);
    expect(deleteNote(notesDir, id)).toBe(false);
    fs.writeFileSync(path.join(root, 'outside.md'), 'x');
    expect(deleteNote(notesDir, '../outside.md')).toBe(false);
    expect(fs.existsSync(path.join(root, 'outside.md'))).toBe(true);
  });
});

describe('searchNotes', () => {
  const notes = () => listNotes(notesDir);

  it('matches title, body and tags case-insensitively, including Cyrillic', () => {
    expect(searchNotes(notes(), 'namecheap')).toHaveLength(1);
    expect(searchNotes(notes(), 'ДОМЕН')).toHaveLength(1);
    expect(searchNotes(notes(), 'sviniabanditka')).toHaveLength(1);
  });

  it('filters by tag exactly', () => {
    expect(searchNotes(notes(), '', 'infra')).toHaveLength(1);
    expect(searchNotes(notes(), '', 'INFRA')).toHaveLength(1);
    expect(searchNotes(notes(), '', 'nope')).toHaveLength(0);
  });

  it('returns everything for an empty query', () => {
    expect(searchNotes(notes(), '')).toHaveLength(1);
  });
});
