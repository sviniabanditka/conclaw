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
 * Transcribe an audio file using whisper.cpp.
 * Returns the transcribed text, or null on failure.
 */
export async function transcribeAudio(
  filePath: string,
): Promise<string | null> {
  if (!fs.existsSync(WHISPER_MODEL)) {
    logger.warn({ model: WHISPER_MODEL }, 'Whisper model not found');
    return null;
  }

  // Convert to WAV if not already
  let wavPath = filePath;
  if (!filePath.endsWith('.wav')) {
    const converted = await convertToWav(filePath);
    if (!converted) return null;
    wavPath = converted;
  }

  return new Promise((resolve) => {
    execFile(
      WHISPER_BIN,
      ['-m', WHISPER_MODEL, '-l', 'auto', '--no-timestamps', '-f', wavPath],
      { timeout: 120_000 },
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
          resolve(null);
          return;
        }

        const text = stdout.trim();
        if (!text) {
          logger.warn({ filePath }, 'Whisper returned empty transcription');
          resolve(null);
          return;
        }

        logger.info(
          { filePath, chars: text.length },
          'Voice message transcribed',
        );
        resolve(text);
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
