import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const envVars = readEnvFile(['WHISPER_BIN', 'WHISPER_MODEL']);

const WHISPER_BIN =
  process.env.WHISPER_BIN || envVars.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  envVars.WHISPER_MODEL ||
  path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');

/**
 * Convert an audio file to 16kHz mono WAV (required by whisper.cpp).
 * Returns the path to the converted file, or null on failure.
 */
function convertToWav(inputPath: string): Promise<string | null> {
  const wavPath = inputPath.replace(/\.[^.]+$/, '.wav');
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-i', inputPath, '-ar', '16000', '-ac', '1', '-y', wavPath],
      { timeout: 30_000 },
      (err) => {
        if (err) {
          logger.error({ err, inputPath }, 'ffmpeg conversion failed');
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
          logger.error({ err, stderr }, 'Whisper transcription failed');
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
