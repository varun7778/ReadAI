# ReadAI (EchoNote) — Project Overview

An AI-powered meeting transcription app. The user records audio in the browser, the backend transcribes it with speaker identification, and Google Gemini generates structured meeting notes.

---

## Architecture

```
ReadAI/
├── Backend/        → FastAPI Python server (port 8000)
│   └── main.py     → Core: transcription pipeline + REST API
└── ReadAI/         → React 19 + TypeScript frontend
    ├── App.tsx      → Main UI logic
    └── services/    → API client, Supabase client, audio utils
```

---

## End-to-End Flow

### 1. User Records Audio (Frontend)
- `Recorder.tsx` captures audio via the browser's `MediaRecorder` API (WebM format)
- User gives it a title, clicks "Analyze Audio"

### 2. Audio Upload & Job Queuing (Frontend → Backend)
- `apiService.ts` sends the audio as `FormData` to `POST /transcribe`
- Backend saves the file to `uploads/`, creates a UUID `job_id`, starts a background task
- Immediately responds with `{job_id}` — no waiting

### 3. Speech Processing Pipeline (Backend — `main.py`)
The `SpeakerDiarizationPipeline` class runs these steps:

```
Audio File
  → FFmpeg → 16kHz mono WAV (required by models)
  → WhisperX (large-v3) → transcript with word-level timestamps
  → Wav2Vec2 alignment → precise word timestamps
  → pyannote/speaker-diarization-3.1 → speaker turns (SPEAKER_00, SPEAKER_01, ...)
  → Merge → assign speakers to each word/segment
  → Export → TXT, JSON, SRT files saved to outputs/
```

### 4. Frontend Polls for Completion
- `apiService.ts` polls `GET /status/{job_id}` every 1.5s (up to 200 attempts, ~5min timeout)
- Once `status === "completed"`, moves to notes generation

### 5. AI Note Generation (Backend)
- Frontend calls `POST /generate/notes/{job_id}`
- Backend feeds the full transcript to **Google Gemini** (via LangChain) with a strict JSON schema
- Gemini returns structured output:
  ```json
  {
    "recap": "2-3 sentence overview",
    "chapters": [{ "title": "...", "summary": "..." }],
    "actionItems": [{ "assignee": "...", "action": "..." }],
    "keyQuestions": [{ "question": "...", "status": "unanswered|..." }]
  }
  ```

### 6. Results Displayed (Frontend)
- `App.tsx` renders:
  - **"The Context"** → full speaker-labeled transcript
  - **"Key Insights"** → chapter summaries from Gemini
  - **"Action Items"** → assignee + task list
- Recording metadata saved to `recordings.json` via `POST /recordings`

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Service info + device status |
| GET | `/health` | Health check |
| GET | `/recordings` | List all recordings |
| POST | `/recordings` | Save/update a recording |
| DELETE | `/recordings/{id}` | Delete recording + cleanup files |
| POST | `/transcribe` | Upload audio, start background job |
| GET | `/status/{job_id}` | Poll processing status |
| GET | `/download/{job_id}/{format}` | Download TXT/JSON/SRT output |
| POST | `/generate/notes/{job_id}` | Generate AI notes via Gemini |
| DELETE | `/cleanup/{job_id}` | Delete job files |

---

## Storage

| Scenario | Storage |
|---|---|
| Normal | `recordings.json` (local) + `uploads/` + `outputs/` |
| Backend down | Supabase Storage (cloud bucket) |
| Both down | Browser `localStorage` |

---

## External Dependencies

| Tool | Where | Purpose |
|---|---|---|
| FFmpeg | Local (system) | Audio format conversion |
| WhisperX large-v3 | Local (GPU/CPU) | Speech-to-text |
| pyannote/speaker-diarization-3.1 | Local (GPU/CPU) | Speaker identification |
| Wav2Vec2 | Local (GPU/CPU) | Word-level timestamp alignment |
| tiktoken | Local (lightweight) | Token counting |
| Google Gemini | Cloud API | Meeting note generation |
| Supabase | Cloud | Audio storage fallback |

---

## Local Backend Components & Cloud Alternatives

### 1. FFmpeg (Audio Conversion)
- **What it does:** Converts WebM/MP3 to 16kHz mono WAV before transcription
- **Cloud alternative:** Not needed if using cloud transcription APIs that accept audio directly (AssemblyAI, Deepgram, etc.)

### 2. WhisperX large-v3 (Transcription)
- **What it does:** Converts speech to text with word-level timestamps
- **Cloud alternatives:**
  - **OpenAI Whisper API** — Same model, pay-per-minute (~$0.006/min)
  - **AssemblyAI** — High accuracy, includes speaker diarization (~$0.37/hr)
  - **Deepgram Nova-2** — Fast + cheap (~$0.0043/min), includes diarization
  - **Gladia** — WhisperX-based cloud API

### 3. pyannote/speaker-diarization-3.1 (Speaker Diarization)
- **What it does:** Identifies who is speaking when (SPEAKER_00, SPEAKER_01)
- **Cloud alternatives:**
  - **AssemblyAI** — Built-in speaker labels, best bundled option
  - **Deepgram** — `diarize=true` parameter, very fast
  - **Pyannote Cloud** — Same model, hosted (pyannote.ai)
  - **Rev.ai** — High accuracy diarization

### 4. Wav2Vec2 Alignment (Word Timestamps)
- **What it does:** Aligns transcript to precise word-level timestamps
- **Cloud alternative:** Included free in AssemblyAI/Deepgram responses

### 5. Google Gemini (Note Generation) — Already Cloud
- **What it does:** Generates recap, chapters, action items, key questions
- **Alternatives:**
  - **Claude (Anthropic)** — Better structured output via tool use
  - **OpenAI GPT-4o** — Strong JSON schema adherence
  - **Groq + Llama** — Fast and cheap for summarization

---

## Recommended Cloud Stack (to replace local GPU)

| Component | Recommended Cloud |
|---|---|
| Transcription + Diarization + Alignment | **AssemblyAI** (bundles all three) |
| OR faster/cheaper | **Deepgram Nova-2** with `diarize=true` |
| Note Generation | **Google Gemini** (already in use) |
| Audio Storage | **Supabase** (already in use) |
| Metadata Storage | Supabase PostgreSQL (replace `recordings.json`) |
| API Server | **Railway / Render / Fly.io** (deploy FastAPI) |
