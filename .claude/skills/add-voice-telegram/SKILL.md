---
name: add-voice-telegram
description: Add local voice message transcription for Telegram using whisper.cpp. Transcribes voice messages to text before passing to the agent. Requires Telegram channel to be set up first.
---

# Add Voice Transcription for Telegram (Local whisper.cpp)

Adds automatic voice message transcription for Telegram using whisper.cpp running locally. Free, private, no API keys needed. Supports Russian and 98 other languages with auto-detection.

**Prerequisites:** Telegram channel must be set up first (`/add-telegram`).

## Phase 1: Pre-flight

Check if already applied:

```bash
grep -q "transcribeAudio" src/channels/telegram.ts && echo "ALREADY_APPLIED" || echo "NEEDS_APPLY"
```

If `ALREADY_APPLIED`, skip to Phase 3 (Install Dependencies).

## Phase 2: Apply Code Changes

### Merge the skill branch

```bash
git fetch upstream skill/voice-transcription-telegram
git merge upstream/skill/voice-transcription-telegram --no-edit || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue --no-edit
}
```

> **Note:** `upstream` is the remote pointing to `sviniabanditka/conclaw`. If using a different remote name, substitute accordingly.

This merges in:
- `src/transcription.ts` — audio conversion (ffmpeg) + whisper.cpp transcription module
- Modified `src/channels/telegram.ts` — voice handler calls transcription before delivering to agent
- `scripts/refresh-token.sh` — OAuth token auto-refresh script

### Validate

```bash
npm install
npm run build
```

## Phase 3: Install Dependencies

### Install ffmpeg

Check if ffmpeg is installed:

```bash
which ffmpeg && echo "OK" || echo "MISSING"
```

If missing:
- **Linux (Debian/Ubuntu):** `sudo apt-get install -y ffmpeg`
- **macOS:** `brew install ffmpeg`

### Install whisper.cpp

Check if whisper-cli is installed:

```bash
whisper-cli --help 2>/dev/null && echo "OK" || echo "MISSING"
```

If missing:

**Linux (build from source):**
```bash
sudo apt-get install -y cmake
cd /tmp && git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
cmake --build build --config Release -j$(nproc)
sudo cp build/bin/whisper-cli /usr/local/bin/
cd / && rm -rf /tmp/whisper.cpp
```

**IMPORTANT:** Use `-DBUILD_SHARED_LIBS=OFF` for static linking. Dynamic builds break after reboot because shared libraries in `/tmp` are cleaned up.

**macOS:**
```bash
brew install whisper-cpp
```

Verify: `whisper-cli --help`

### Download model

```bash
mkdir -p data/models
```

Choose model based on available RAM:

| Model | Size | RAM needed | Quality |
|-------|------|-----------|---------|
| base  | 141MB | 2GB+ | Good for most languages |
| small | 461MB | 4GB+ | Better accuracy |

**2GB RAM (e.g. Raspberry Pi 5 2GB):**
```bash
curl -L -o data/models/ggml-base.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

**4GB+ RAM:**
```bash
curl -L -o data/models/ggml-small.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
```

If using the small model, set in `.env`:
```bash
echo 'WHISPER_MODEL=data/models/ggml-small.bin' >> .env
```

### Test transcription

```bash
# Generate a short test WAV
ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -ar 16000 -ac 1 /tmp/test-whisper.wav -y 2>/dev/null
whisper-cli -m data/models/ggml-base.bin --no-timestamps -f /tmp/test-whisper.wav
rm /tmp/test-whisper.wav
```

If whisper-cli loads the model and produces output (even empty for a sine wave), it works.

## Phase 4: OAuth Token Auto-Refresh (Claude Subscription Only)

Skip this phase if using an Anthropic API key instead of a Claude subscription.

Claude OAuth tokens expire every ~7 hours. The included `scripts/refresh-token.sh` automatically refreshes them. See also the `/refresh-token` skill for detailed cron setup.

### Quick setup

```bash
chmod +x scripts/refresh-token.sh
bash scripts/refresh-token.sh  # test it
(crontab -l 2>/dev/null | grep -v refresh-token; echo "0 * * * * $(pwd)/scripts/refresh-token.sh >> $(pwd)/logs/token-refresh.log 2>&1") | crontab -
```

Verify: `crontab -l | grep refresh`

## Phase 5: Build and Restart

```bash
npm run build
# Linux:
systemctl --user restart conclaw
# macOS:
launchctl kickstart -k gui/$(id -u)/com.conclaw
```

## Phase 6: Verify

Send a voice message to the Telegram bot. Check logs:

```bash
tail -f logs/conclaw.log | grep -i -E "voice|transcri|whisper"
```

Expected: `Voice message transcribed` log entry with character count.

On Raspberry Pi 5, transcription takes 5-15 seconds per message depending on length.

## Troubleshooting

### "whisper-cli: error while loading shared libraries"
Whisper was built with dynamic linking. Rebuild with `-DBUILD_SHARED_LIBS=OFF` (see Phase 3).

### Voice messages arrive as "[Voice message]" without transcription
- Check whisper-cli works: `whisper-cli -m data/models/ggml-base.bin --help`
- Check model exists: `ls -la data/models/ggml-*.bin`
- Check ffmpeg: `which ffmpeg`
- Check logs for errors: `grep -i "whisper\|transcri\|ffmpeg" logs/conclaw.log`

### Token expires overnight
- Verify cron is running: `crontab -l | grep refresh`
- Check refresh log: `cat logs/token-refresh.log`
- Ensure Claude Code is logged in: `claude auth status`

## Removal

```bash
# Revert telegram.ts voice handler to default
git checkout upstream/skill/telegram -- src/channels/telegram.ts

# Remove transcription module and refresh script
rm src/transcription.ts scripts/refresh-token.sh

# Remove cron job
crontab -l | grep -v refresh-token | crontab -

# Optionally remove whisper and model
sudo rm /usr/local/bin/whisper-cli
rm -rf data/models/ggml-*.bin

# Rebuild
npm run build
systemctl --user restart conclaw  # or launchctl kickstart on macOS
```
