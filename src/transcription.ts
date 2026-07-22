/**
 * Turning a Telegram voice note into text, with whisper.cpp on the host.
 *
 * Two separate binaries are involved and both have to be found: ffmpeg, because
 * whisper.cpp reads 16 kHz mono WAV and Telegram sends Opus, and whisper-cli
 * itself. Each is configurable by absolute path, because the pod that runs this
 * keeps user-installed tools in a directory that is not on the service's PATH —
 * and a bare name that resolves in your shell but not in the running process is
 * a failure that only shows up on the first voice message, hours later.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const envVars = readEnvFile(['WHISPER_BIN', 'WHISPER_MODEL', 'FFMPEG_BIN']);

const WHISPER_BIN =
  process.env.WHISPER_BIN || envVars.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  envVars.WHISPER_MODEL ||
  path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');
const FFMPEG_BIN = process.env.FFMPEG_BIN || envVars.FFMPEG_BIN || 'ffmpeg';

/**
 * Convert an audio file to 16kHz mono WAV (required by whisper.cpp).
 * Returns the path to the converted file, or null on failure.
 */
function convertToWav(inputPath: string): Promise<string | null> {
  const wavPath = inputPath.replace(/\.[^.]+$/, '.wav');
  return new Promise((resolve) => {
    execFile(
      FFMPEG_BIN,
      ['-i', inputPath, '-ar', '16000', '-ac', '1', '-y', wavPath],
      { timeout: 30_000 },
      (err) => {
        if (err) {
          logger.error(
            { err, inputPath, ffmpeg: FFMPEG_BIN },
            'ffmpeg conversion failed',
          );
          resolve(null);
        } else {
          resolve(wavPath);
        }
      },
    );
  });
}

/**
 * How long a recording may be before transcription is refused.
 *
 * Measured on this install: whisper.cpp with the `small` model runs at roughly
 * real time — 45 s of CPU for 40 s of audio — and pegs every core it is given
 * for the whole run, on the same box as the bot. Half an hour of audio is
 * therefore half an hour of grinding, which is the most that is worth doing
 * without asking.
 */
export const MAX_AUDIO_SECONDS = 30 * 60;

/** Duration in seconds, or null when ffprobe cannot say. */
export function audioDurationSeconds(filePath: string): Promise<number | null> {
  const probe = FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe');
  return new Promise((resolve) => {
    execFile(
      probe,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        filePath,
      ],
      { timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          logger.debug({ err, filePath }, 'ffprobe failed');
          resolve(null);
          return;
        }
        const seconds = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(seconds) ? seconds : null);
      },
    );
  });
}

export type TranscriptionOutcome =
  | { ok: true; text: string; seconds: number | null }
  | { ok: false; reason: 'too-long'; seconds: number }
  | { ok: false; reason: 'failed' };

/**
 * Transcribe an audio file using whisper.cpp.
 *
 * Refuses anything past {@link MAX_AUDIO_SECONDS} rather than starting a run
 * that will not finish: the caller can then say so, which is far better than a
 * silent timeout an hour later.
 */
export async function transcribeAudio(
  filePath: string,
): Promise<TranscriptionOutcome> {
  if (!fs.existsSync(WHISPER_MODEL)) {
    logger.warn({ model: WHISPER_MODEL }, 'Whisper model not found');
    return { ok: false, reason: 'failed' };
  }

  const seconds = await audioDurationSeconds(filePath);
  if (seconds !== null && seconds > MAX_AUDIO_SECONDS) {
    logger.info({ filePath, seconds }, 'Recording too long to transcribe');
    return { ok: false, reason: 'too-long', seconds };
  }

  // Convert to WAV if not already
  let wavPath = filePath;
  if (!filePath.endsWith('.wav')) {
    const converted = await convertToWav(filePath);
    if (!converted) return { ok: false, reason: 'failed' };
    wavPath = converted;
  }

  // Roughly real time, so the budget has to scale with the recording. The
  // floor covers model load on a short clip; the multiplier is headroom for a
  // box that is also running the bot and a container or two.
  const timeoutMs = Math.max(120_000, (seconds ?? 0) * 3_000);

  return new Promise((resolve) => {
    execFile(
      WHISPER_BIN,
      [
        '-m', WHISPER_MODEL,
        '-l', 'auto',
        '-t', String(Math.max(1, os.cpus().length)),
        '--no-timestamps',
        '-f', wavPath,
      ],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // Clean up converted WAV
        if (wavPath !== filePath) {
          fs.unlink(wavPath, () => {});
        }

        if (err) {
          logger.error(
            { err, stderr, whisper: WHISPER_BIN },
            'Whisper transcription failed',
          );
          resolve({ ok: false, reason: 'failed' });
          return;
        }

        const text = stdout.trim();
        if (!text) {
          logger.warn({ filePath }, 'Whisper returned empty transcription');
          resolve({ ok: false, reason: 'failed' });
          return;
        }

        logger.info(
          { filePath, chars: text.length, seconds },
          'Audio transcribed',
        );
        resolve({ ok: true, text, seconds });
      },
    );
  });
}

export interface TranscriptionProbe {
  exists: (file: string) => boolean;
  /** Whether a binary can actually be launched from this process. */
  canRun: (bin: string) => Promise<boolean>;
}

const defaultProbe: TranscriptionProbe = {
  exists: (file) => fs.existsSync(file),
  canRun: (bin) =>
    new Promise((resolve) => {
      // Only the spawn matters: a non-zero exit still proves it was found.
      execFile(bin, ['--help'], { timeout: 10_000 }, (err) => {
        resolve(!(err && (err as NodeJS.ErrnoException).code === 'ENOENT'));
      });
    }),
};

/**
 * List what is missing for voice transcription, in plain words.
 *
 * Called at startup so a half-installed setup is reported when the service
 * comes up rather than on the first voice note — the symptom otherwise is the
 * agent receiving `[Voice message]` with no explanation and guessing at the
 * cause, which it does badly and confidently.
 */
export async function transcriptionProblems(
  probe: TranscriptionProbe = defaultProbe,
): Promise<string[]> {
  const problems: string[] = [];
  if (!probe.exists(WHISPER_MODEL)) {
    problems.push(`whisper model not found at ${WHISPER_MODEL}`);
  }
  if (!(await probe.canRun(WHISPER_BIN))) {
    problems.push(`whisper binary '${WHISPER_BIN}' not found on PATH`);
  }
  if (!(await probe.canRun(FFMPEG_BIN))) {
    problems.push(`ffmpeg binary '${FFMPEG_BIN}' not found on PATH`);
  }
  return problems;
}
