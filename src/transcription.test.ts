/**
 * The startup check for voice transcription.
 *
 * It exists because of a real failure: whisper-cli was configured by absolute
 * path and worked, while ffmpeg was invoked by bare name and was not on the
 * service's PATH — so voice notes silently arrived as `[Voice message]` and
 * the agent invented a reason. Each dependency has to be reported separately,
 * or the report sends you looking at the wrong one.
 */
import { describe, it, expect, vi } from 'vitest';

import { transcriptionProblems, type TranscriptionProbe } from './transcription.js';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function probe(over: Partial<TranscriptionProbe> = {}): TranscriptionProbe {
  return {
    exists: () => true,
    canRun: () => Promise.resolve(true),
    ...over,
  };
}

describe('transcriptionProblems', () => {
  it('reports nothing when everything is in place', async () => {
    expect(await transcriptionProblems(probe())).toEqual([]);
  });

  it('reports a missing model', async () => {
    const problems = await transcriptionProblems(probe({ exists: () => false }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/model not found/);
  });

  // The failure that prompted this: whisper fine, ffmpeg missing.
  it('names ffmpeg specifically when only ffmpeg cannot be launched', async () => {
    const problems = await transcriptionProblems(
      probe({ canRun: (bin) => Promise.resolve(!bin.includes('ffmpeg')) }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ffmpeg/);
    expect(problems[0]).not.toMatch(/whisper/);
  });

  it('names whisper specifically when only whisper cannot be launched', async () => {
    const problems = await transcriptionProblems(
      probe({ canRun: (bin) => Promise.resolve(bin.includes('ffmpeg')) }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/whisper binary/);
  });

  it('reports every problem at once rather than the first', async () => {
    const problems = await transcriptionProblems(
      probe({ exists: () => false, canRun: () => Promise.resolve(false) }),
    );
    expect(problems).toHaveLength(3);
  });
});
