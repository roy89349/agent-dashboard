# Voice notes → tasks (Telegram)

Speak an idea to the Mission Control bot and it becomes the same **"make this a task?"**
manager-confirm card a typed message produces. You talk; the Manager proposes a decomposition;
you approve it.

## The privacy / sellability angle (why local whisper)

Transcription runs **entirely on the VPS** with a local [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
binary:

- **No external STT API** — nothing is sent to OpenAI/Google/Deepgram/etc.
- **No API keys, no metered costs** — no per-minute billing to leak into a customer's install.
- **The audio and the transcript never leave the server.** The OGG is downloaded to a private temp
  file (`0600`, under `os.tmpdir()`), transcribed locally, and **deleted in a `finally`** — win or lose.
- Anything logged is **redacted first** (`lib/redact.ts`), same as every other phone message.

This keeps voice notes consistent with the rest of dev-fleet: self-hosted, no third-party data egress.

## How it works (inbound flow)

1. Telegram delivers an update to `app/api/integrations/telegram/webhook/route.ts`.
2. The webhook self-authenticates exactly as before: optional webhook-secret header **and**
   `verifySender(chatId)` against `TELEGRAM_ALLOWED_CHAT_ID`. A voice note from anyone else is ignored,
   exactly like a text message from a stranger — **we never even download the audio**.
3. For an allowed sender, the route detects `message.voice` (or `message.audio`) **before** the text
   branch and calls `transcribeVoice(fileId)` in `lib/phone/transcribe.ts`:
   - `getFile` (Bot API, existing bot token) → download the OGG to a `0600` temp file,
   - convert to 16 kHz mono WAV with `ffmpeg` (whisper.cpp needs WAV),
   - run the whisper binary with `--no-timestamps --language auto --output-txt` (hard 120 s timeout),
   - read + trim the transcript, then **delete every temp file**.
4. The transcript is fed through the **exact same pipeline a text message uses** — `routeCommand` →
   `executeCommand`. A plain spoken idea becomes a `free_text` plan → the "Want me to make this a task?"
   card with the same buttons. No logic is forked for voice.

## Turning it on

Off by default (`VOICE_NOTES != "on"`), so small installs and CI are unaffected.

1. Install a local whisper + model on the VPS:
   ```bash
   bash deploy/install-whisper.sh              # ggml-base (fast)
   MODEL=medium bash deploy/install-whisper.sh # better Dutch (more RAM/CPU)
   ```
2. Paste the printed values into `mission-control/.env.local`:
   ```
   VOICE_NOTES=on
   WHISPER_BIN=/opt/whisper.cpp/build/bin/whisper-cli
   WHISPER_MODEL=/opt/whisper.cpp/models/ggml-base.bin
   FFMPEG_BIN=ffmpeg
   # WHISPER_LANG=nl   # optional: force Dutch instead of auto-detect
   ```
3. Restart the dashboard service. Send the bot a voice note.

## Dutch model note

`ggml-base` is fastest but only ok for Dutch. For noticeably better Dutch use `ggml-small` or,
best, `ggml-medium` (~2.6 GB RAM, ~1× realtime on CPU — still fine on a CPX32-class VPS, since voice
notes are short). Or pin `WHISPER_LANG=nl` to skip language auto-detection.

## Graceful degradation (when off or broken)

`transcribeVoice` **never throws** — it returns `{ error }`:

- `VOICE_NOTES` off or a binary/model/token missing → `{ error: "voice_disabled" }` → the bot replies
  "🎤 voice notes staan uit" and does nothing else (no spawn, no download).
- Any download/convert/transcribe failure or timeout → `{ error: ... }` → the bot replies
  "🎤 kon de spraaknotitie niet verwerken".

Either way the webhook **always returns 200** so Telegram doesn't retry, and a text-only install behaves
exactly as it did before this feature existed.
