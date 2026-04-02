"""
language_analyzer.py
Core logic for the language improvement tracker.
Responsibilities:
  - SQLite schema init
  - Hard metrics (no LLM)
  - Gemini API call (via langchain)
  - DB writes
  - Query helpers for GET endpoints
"""

import sqlite3
import re
import os
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.absolute()
DB_PATH = str(BASE_DIR / "language_tracker.db")

FILLER_SET = {"um", "uh", "like", "basically"}
FILLER_PHRASES = ["you know", "kind of", "i mean"]

GEMINI_MODEL = "google_genai:gemini-3-flash-preview"

SYSTEM_PROMPT = (
    "You are an expert language coach specialising in spoken English improvement. "
    "You MUST respond with valid JSON only — no markdown fences, no prose outside the JSON object."
)

# ─── Schema ──────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date     TEXT NOT NULL,
    transcript       TEXT NOT NULL,
    duration_seconds INTEGER,
    overall_score    REAL,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metrics (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id           INTEGER REFERENCES sessions(id),
    filler_rate          REAL,
    slang_count          INTEGER,
    new_slang_count      INTEGER,
    avg_sentence_length  REAL,
    vocabulary_richness  REAL,
    hesitation_count     INTEGER,
    fluency_score        REAL,
    naturalness_score    REAL
);

CREATE TABLE IF NOT EXISTS slang_bank (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    term             TEXT NOT NULL,
    first_used_date  TEXT,
    use_count        INTEGER DEFAULT 1,
    example_sentence TEXT
);

CREATE TABLE IF NOT EXISTS corrections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       INTEGER REFERENCES sessions(id),
    what_was_said    TEXT NOT NULL,
    what_to_say      TEXT NOT NULL,
    why              TEXT NOT NULL,
    register         TEXT,
    context_sentence TEXT,
    is_recurring     BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profile (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    content    TEXT NOT NULL
);
"""


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist. Safe to call on every startup."""
    conn = get_db()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        logger.info("language_tracker.db initialised at %s", DB_PATH)
    finally:
        conn.close()


# ─── Hard Metrics ─────────────────────────────────────────────────────────────

def compute_hard_metrics(transcript: str, duration_seconds: int) -> dict:
    """Pure Python — no LLM. Returns filler_rate, avg_sentence_length, vocabulary_richness, hesitation_count."""
    text = transcript.lower()

    # Count filler phrases before word-splitting
    hesitation_count = sum(text.count(p) for p in FILLER_PHRASES)

    words = re.findall(r"\b[a-z']+\b", text)
    filler_word_count = sum(1 for w in words if w in FILLER_SET)
    total_fillers = filler_word_count + hesitation_count

    minutes = max(duration_seconds / 60.0, 0.001)
    filler_rate = round(total_fillers / minutes, 2)

    sentences = [s.strip() for s in re.split(r"[.?!]+", transcript) if s.strip()]
    if sentences:
        avg_sentence_length = round(
            sum(len(re.findall(r"\b\w+\b", s)) for s in sentences) / len(sentences), 2
        )
    else:
        avg_sentence_length = 0.0

    # Strip fillers before vocabulary richness to avoid inflating unique count
    content_words = [w for w in words if w not in FILLER_SET and len(w) > 1]
    vocabulary_richness = round(len(set(content_words)) / len(content_words), 4) if content_words else 0.0

    return {
        "filler_rate": filler_rate,
        "avg_sentence_length": avg_sentence_length,
        "vocabulary_richness": vocabulary_richness,
        "hesitation_count": hesitation_count,
    }


# ─── Profile helpers ──────────────────────────────────────────────────────────

def _get_profile(conn: sqlite3.Connection) -> Optional[str]:
    row = conn.execute("SELECT content FROM profile ORDER BY id LIMIT 1").fetchone()
    return row["content"] if row else None


def _upsert_profile(conn: sqlite3.Connection, content: str):
    existing = conn.execute("SELECT id FROM profile LIMIT 1").fetchone()
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        conn.execute("UPDATE profile SET content = ?, updated_at = ? WHERE id = ?",
                     (content, now, existing["id"]))
    else:
        conn.execute("INSERT INTO profile (content, updated_at) VALUES (?, ?)", (content, now))


def _get_recent_metrics(conn: sqlite3.Connection, limit: int = 5) -> list:
    rows = conn.execute("""
        SELECT s.session_date, s.overall_score,
               m.filler_rate, m.avg_sentence_length, m.vocabulary_richness,
               m.fluency_score, m.naturalness_score, m.slang_count
        FROM sessions s JOIN metrics m ON m.session_id = s.id
        ORDER BY s.id DESC LIMIT ?
    """, (limit,)).fetchall()
    return [dict(r) for r in rows]


# ─── Claude call ──────────────────────────────────────────────────────────────

def _build_user_prompt(transcript: str, hard: dict, profile: Optional[str], recent: list) -> str:
    profile_section = profile if profile else "No profile yet — this is the user's first session."
    recent_section = json.dumps(recent, indent=2) if recent else "No previous sessions."

    return f"""Analyse this spoken English transcript and return a JSON object with EXACTLY these keys:

{{
  "fluency_score": <float 1-10>,
  "naturalness_score": <float 1-10>,
  "overall_score": <average of the two above>,
  "slang_detected": [<string term>, ...],
  "corrections": [
    {{
      "what_was_said": "<exact phrase from transcript>",
      "what_to_say": "<more natural or correct version>",
      "why": "<one sentence explanation>",
      "register": "<casual | formal | both>",
      "context_sentence": "<the full sentence it appeared in>"
    }}
  ],
  "session_feedback": {{
    "strengths": ["<string>", ...],
    "focus_areas": ["<string>", ...],
    "progress_vs_last_session": "<string>"
  }},
  "updated_profile": "<~300 word narrative: recurring strengths, persistent mistakes, slang level, fluency trend>"
}}

Find 3-7 corrections. Prioritise: grammatical errors, unnatural phrasing, overused hedging, stative verb misuse.
If there are no prior sessions, set progress_vs_last_session to "First session — no comparison available."

--- CURRENT LEARNER PROFILE ---
{profile_section}

--- LAST {len(recent)} SESSIONS (metrics) ---
{recent_section}

--- TODAY'S TRANSCRIPT ---
{transcript}

--- HARD METRICS ALREADY COMPUTED ---
filler_rate (per min): {hard['filler_rate']}
avg_sentence_length (words): {hard['avg_sentence_length']}
vocabulary_richness (TTR): {hard['vocabulary_richness']}
hesitation_count: {hard['hesitation_count']}"""


def call_gemini(transcript: str, hard_metrics: dict, profile: Optional[str], recent: list) -> dict:
    model = init_chat_model(GEMINI_MODEL, temperature=0.7, max_tokens=4096)
    prompt = _build_user_prompt(transcript, hard_metrics, profile, recent)
    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=prompt)]

    def _extract_text(content) -> str:
        if isinstance(content, list):
            return "".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content).strip()
        return str(content).strip()

    def _clean(raw: str) -> str:
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        return re.sub(r"\s*```$", "", raw)

    raw = _clean(_extract_text(model.invoke(messages).content))

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Gemini returned invalid JSON on first attempt — retrying with correction hint")
        retry_messages = messages + [
            HumanMessage(content=f"You returned invalid JSON:\n{raw}\n\nFix it and return only the corrected JSON object."),
        ]
        raw2 = _clean(_extract_text(model.invoke(retry_messages).content))
        return json.loads(raw2)


# ─── Slang bank ───────────────────────────────────────────────────────────────

def _upsert_slang(conn: sqlite3.Connection, term: str, example: str, today: str) -> bool:
    """Returns True if the term is new."""
    existing = conn.execute("SELECT id, use_count FROM slang_bank WHERE term = ?",
                            (term.lower(),)).fetchone()
    if existing:
        conn.execute("UPDATE slang_bank SET use_count = ? WHERE id = ?",
                     (existing["use_count"] + 1, existing["id"]))
        return False
    conn.execute(
        "INSERT INTO slang_bank (term, first_used_date, use_count, example_sentence) VALUES (?, ?, 1, ?)",
        (term.lower(), today, example),
    )
    return True


def _mark_recurring(conn: sqlite3.Connection, session_id: int):
    conn.execute("""
        UPDATE corrections SET is_recurring = 1
        WHERE session_id = ?
          AND what_was_said IN (
              SELECT DISTINCT what_was_said FROM corrections WHERE session_id != ?
          )
    """, (session_id, session_id))


# ─── Full pipeline ────────────────────────────────────────────────────────────

def run_analysis(transcript: str, duration_seconds: int) -> dict:
    """
    Entry point for the FastAPI endpoint and CLI.
    Returns a camelCase dict matching the frontend LanguageAnalysisResult type.
    """
    conn = get_db()
    try:
        hard = compute_hard_metrics(transcript, duration_seconds)
        profile = _get_profile(conn)
        recent = _get_recent_metrics(conn, limit=5)

        claude = call_gemini(transcript, hard, profile, recent)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Insert session
        cur = conn.execute(
            "INSERT INTO sessions (session_date, transcript, duration_seconds, overall_score) VALUES (?, ?, ?, ?)",
            (today, transcript, duration_seconds, claude.get("overall_score")),
        )
        session_id = cur.lastrowid

        # Upsert slang
        slang_list = claude.get("slang_detected", [])
        new_slang_count = 0
        for term in slang_list:
            example = next(
                (c.get("context_sentence", "") for c in claude.get("corrections", [])
                 if term.lower() in c.get("context_sentence", "").lower()),
                "",
            )
            if _upsert_slang(conn, term, example, today):
                new_slang_count += 1

        # Insert metrics
        conn.execute("""
            INSERT INTO metrics
              (session_id, filler_rate, slang_count, new_slang_count,
               avg_sentence_length, vocabulary_richness, hesitation_count,
               fluency_score, naturalness_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id,
            hard["filler_rate"],
            len(slang_list),
            new_slang_count,
            hard["avg_sentence_length"],
            hard["vocabulary_richness"],
            hard["hesitation_count"],
            claude.get("fluency_score"),
            claude.get("naturalness_score"),
        ))

        # Insert corrections
        for c in claude.get("corrections", []):
            conn.execute("""
                INSERT INTO corrections
                  (session_id, what_was_said, what_to_say, why, register, context_sentence)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                c.get("what_was_said", ""),
                c.get("what_to_say", ""),
                c.get("why", ""),
                c.get("register", "both"),
                c.get("context_sentence", ""),
            ))

        _mark_recurring(conn, session_id)

        # Update profile
        updated_profile = claude.get("updated_profile", "")
        if updated_profile:
            _upsert_profile(conn, updated_profile)

        conn.commit()

        # Re-fetch corrections with is_recurring flags
        corrections_rows = conn.execute(
            "SELECT * FROM corrections WHERE session_id = ?", (session_id,)
        ).fetchall()

        feedback = claude.get("session_feedback", {})

        return {
            "sessionId": session_id,
            "overallScore": claude.get("overall_score"),
            "fluencyScore": claude.get("fluency_score"),
            "naturalnessScore": claude.get("naturalness_score"),
            "fillerRate": hard["filler_rate"],
            "avgSentenceLength": hard["avg_sentence_length"],
            "vocabularyRichness": hard["vocabulary_richness"],
            "corrections": [
                {
                    "whatWasSaid": r["what_was_said"],
                    "whatToSay": r["what_to_say"],
                    "why": r["why"],
                    "register": r["register"],
                    "contextSentence": r["context_sentence"],
                    "isRecurring": bool(r["is_recurring"]),
                }
                for r in corrections_rows
            ],
            "strengths": feedback.get("strengths", []),
            "focusAreas": feedback.get("focus_areas", []),
            "progressVsLastSession": feedback.get("progress_vs_last_session", ""),
        }

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── Query helpers (used by GET endpoints) ───────────────────────────────────

def get_all_sessions() -> list:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, session_date, duration_seconds, overall_score, created_at FROM sessions ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_session_detail(session_id: int) -> Optional[dict]:
    conn = get_db()
    try:
        s = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not s:
            return None
        m = conn.execute("SELECT * FROM metrics WHERE session_id = ?", (session_id,)).fetchone()
        corrections = conn.execute(
            "SELECT * FROM corrections WHERE session_id = ?", (session_id,)
        ).fetchall()
        return {
            "session": dict(s),
            "metrics": dict(m) if m else {},
            "corrections": [dict(c) for c in corrections],
        }
    finally:
        conn.close()


def get_metrics_history(limit: int = 10) -> list:
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT s.id, s.session_date, s.overall_score,
                   m.fluency_score, m.naturalness_score, m.filler_rate,
                   m.vocabulary_richness, m.slang_count, m.avg_sentence_length
            FROM sessions s JOIN metrics m ON m.session_id = s.id
            ORDER BY s.id DESC LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_recurring_corrections() -> list:
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT what_was_said, what_to_say, why, register,
                   COUNT(*) as session_count,
                   GROUP_CONCAT(session_id) as session_ids
            FROM corrections
            WHERE is_recurring = 1
            GROUP BY what_was_said
            ORDER BY session_count DESC
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_slang_bank() -> list:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM slang_bank ORDER BY use_count DESC, first_used_date DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
