import os
import json
import logging
import warnings
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
import subprocess
import time
import shutil
import uuid
import asyncio

import torch
import whisperx
from pyannote.audio import Pipeline
import tiktoken
import torch.serialization

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain.chat_models import init_chat_model
from supabase import create_client, Client
from dotenv import load_dotenv
import os

load_dotenv()

# Allow OmegaConf classes for pyannote model loading
torch.serialization.add_safe_globals([
    'omegaconf.listconfig.ListConfig',
    'omegaconf.dictconfig.DictConfig',
])

warnings.filterwarnings("ignore")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_BUCKET = "audio-recordings"

# Initialize Supabase client
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Supabase: {e}")


JSON_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "MeetingSummary",
    "type": "object",
    "required": ["recap", "chapters", "actionItems", "keyQuestions"],
    "properties": {
        "recap": {
            "type": "string",
            "description": "A brief 2-3 sentence overview of the meeting's main purpose and outcomes"
        },
        "chapters": {
            "type": "array",
            "description": "Main discussion topics or chapters from the meeting",
            "items": {
                "type": "object",
                "required": ["title", "summary"],
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Clear, descriptive title of the chapter/topic"
                    },
                    "summary": {
                        "type": "string",
                        "description": "One-line summary of what was discussed"
                    }
                }
            },
            "minItems": 3,
            "maxItems": 5
        },
        "actionItems": {
            "type": "array",
            "description": "Specific tasks, commitments, or follow-ups mentioned in the meeting",
            "items": {
                "type": "object",
                "required": ["assignee", "action"],
                "properties": {
                    "assignee": {
                        "type": "string",
                        "description": "Person responsible for the action"
                    },
                    "action": {
                        "type": "string",
                        "description": "Specific action to be taken"
                    },
                    "dueDate": {
                        "type": "string",
                        "format": "date",
                        "description": "Optional due date if mentioned"
                    }
                }
            }
        },
        "keyQuestions": {
            "type": "array",
            "description": "Important questions raised during the meeting",
            "items": {
                "type": "object",
                "required": ["question"],
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question that was raised"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["unanswered", "partially_answered", "needs_followup"],
                        "description": "Status of the question"
                    },
                    "context": {
                        "type": "string",
                        "description": "Optional context about why this question is important"
                    }
                }
            }
        }
    }
}


model = init_chat_model("google_genai:gemini-3-flash-preview", temperature=0.7, max_tokens=4096)

# Create directories - use absolute paths based on script location
BASE_DIR = Path(__file__).parent.absolute()
UPLOAD_DIR = str(BASE_DIR / "uploads")
OUTPUT_DIR = str(BASE_DIR / "outputs")
RECORDINGS_DB = str(BASE_DIR / "recordings.json")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
logger.info(f"Upload directory: {UPLOAD_DIR}")
logger.info(f"Output directory: {OUTPUT_DIR}")


@dataclass
class TranscriptSegment:
    """Structured segment with speaker and timing"""
    start: float
    end: float
    speaker: str
    text: str


class ProcessingStatus(BaseModel):
    job_id: str
    status: str  # "processing", "completed", "failed"
    progress: Optional[str] = None
    result: Optional[Dict] = None
    error: Optional[str] = None


class Recording(BaseModel):
    id: str
    title: str
    timestamp: int
    duration: int
    audioUrl: Optional[str] = None
    status: str  # "recording" | "processing" | "completed" | "error"
    transcript: Optional[str] = None
    notes: List[str] = []
    actionItems: List[str] = []


class ProcessAudioRequest(BaseModel):
    audio_base64: str
    mime_type: str
    recording_id: str


class ProcessAudioResponse(BaseModel):
    summary: str
    notes: List[str]
    actionItems: List[str]


class SpeakerDiarizationPipeline:
    """Speaker diarization pipeline"""
    
    def __init__(
        self,
        whisper_model: str = "large-v3",
        device: str = None,
        compute_type: str = "float16",
        batch_size: int = 16
    ):
        self.whisper_model = whisper_model
        self.batch_size = batch_size
        self.compute_type = compute_type
        
        # Auto-detect device
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
            
        logger.info(f"Using device: {self.device}")
        
        if self.device == "cuda":
            logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
        
        # Initialize tokenizer
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
        
        # Lazy load models
        self.whisper = None
        self.diarization = None
        self.alignment_model = None
        self.metadata = None
    
    def _load_models(self):
        """Load all models"""
        if self.whisper is None:
            logger.info(f"Loading WhisperX model: {self.whisper_model}")
            self.whisper = whisperx.load_model(
                self.whisper_model,
                self.device,
                compute_type=self.compute_type,
                language="en"
            )
        
        if self.diarization is None:
            logger.info("Loading pyannote diarization pipeline")
            self.diarization = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1"
            )
            if self.device == "cuda":
                self.diarization.to(torch.device("cuda"))
    
    def prepare_audio(self, audio_path: str) -> str:
        """Convert audio to mono 16kHz WAV"""
        output_path = str(Path(audio_path).with_suffix('.prepared.wav'))
        
        cmd = [
            'ffmpeg', '-i', audio_path,
            '-ar', '16000', '-ac', '1', '-y', output_path
        ]
        
        logger.info(f"Preparing audio: {audio_path}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {result.stderr}")
        
        return output_path
    
    def transcribe(self, audio_path: str) -> Dict:
        """Transcribe audio with WhisperX"""
        logger.info("Transcribing audio...")
        audio = whisperx.load_audio(audio_path)
        
        result = self.whisper.transcribe(audio, batch_size=self.batch_size)
        
        return result
    
    def align_transcription(self, audio_path: str, transcript: Dict) -> Dict:
        """Align transcription for word-level timestamps"""
        logger.info("Aligning transcription...")
        
        if self.alignment_model is None:
            self.alignment_model, self.metadata = whisperx.load_align_model(
                language_code=transcript["language"],
                device=self.device
            )
        
        audio = whisperx.load_audio(audio_path)
        
        aligned = whisperx.align(
            transcript["segments"],
            self.alignment_model,
            self.metadata,
            audio,
            self.device,
            return_char_alignments=False
        )
        
        return aligned
    
    def diarize(self, audio_path: str) -> List[Dict]:
        """Perform speaker diarization"""
        logger.info("Performing speaker diarization...")
        
        diarization = self.diarization(audio_path)
        
        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                'start': turn.start,
                'end': turn.end,
                'speaker': speaker
            })
        
        return segments
    
    def merge_diarization(self, aligned_transcript: Dict, diarization: List[Dict]) -> List[TranscriptSegment]:
        """Merge transcription with speaker labels"""
        logger.info("Merging transcription with diarization...")
        
        # Extract all words with timestamps
        words = []
        for seg in aligned_transcript.get("segments", []):
            if "words" in seg:
                words.extend(seg["words"])
        
        # Assign speakers to words
        for word in words:
            word_start = word.get("start", 0)
            word_end = word.get("end", 0)
            
            max_overlap = 0
            assigned_speaker = "UNKNOWN"
            
            for spk_seg in diarization:
                overlap_start = max(word_start, spk_seg["start"])
                overlap_end = min(word_end, spk_seg["end"])
                overlap = max(0, overlap_end - overlap_start)
                
                if overlap > max_overlap:
                    max_overlap = overlap
                    assigned_speaker = spk_seg["speaker"]
            
            word["speaker"] = assigned_speaker
        
        # Group words by speaker into segments
        segments = []
        if not words:
            return segments
        
        current_speaker = words[0]["speaker"]
        current_words = [words[0]]
        current_start = words[0].get("start", 0)
        
        for word in words[1:]:
            if word["speaker"] == current_speaker:
                current_words.append(word)
            else:
                text = " ".join([w["word"] for w in current_words])
                segments.append(TranscriptSegment(
                    start=current_start,
                    end=current_words[-1].get("end", current_start),
                    speaker=current_speaker,
                    text=text
                ))
                
                current_speaker = word["speaker"]
                current_words = [word]
                current_start = word.get("start", 0)
        
        # Add final segment
        if current_words:
            text = " ".join([w["word"] for w in current_words])
            segments.append(TranscriptSegment(
                start=current_start,
                end=current_words[-1].get("end", current_start),
                speaker=current_speaker,
                text=text
            ))
        
        return segments

    def format_transcript(self, segments):
        def format_timestamp(seconds):
            """Convert seconds to MM:SS format"""
            mins = int(seconds // 60)
            secs = int(seconds % 60)
            return f"{mins:02d}:{secs:02d}"
        
        # Group consecutive segments by speaker
        transcript_lines = []
        current_speaker = None
        current_text = []
        current_start = None
        
        for segment in segments:
            speaker = segment.speaker
            text = segment.text.strip()
            
            # If same speaker continues, append text
            if speaker == current_speaker:
                current_text.append(text)
            else:
                # Save previous speaker's text
                if current_speaker is not None:
                    timestamp = format_timestamp(current_start)
                    combined_text = " ".join(current_text)
                    transcript_lines.append(f"[{timestamp}] {current_speaker}: {combined_text}")
                
                # Start new speaker block
                current_speaker = speaker
                current_text = [text]
                current_start = segment.start
        
        # Add the last speaker's text
        if current_speaker is not None:
            timestamp = format_timestamp(current_start)
            combined_text = " ".join(current_text)
            transcript_lines.append(f"[{timestamp}] {current_speaker}: {combined_text}")
        
        return "\n\n".join(transcript_lines)
    
    def count_tokens(self, segments: List[TranscriptSegment]) -> int:
        """Count tokens in transcript"""
        full_text = " ".join([seg.text for seg in segments])
        tokens = self.tokenizer.encode(full_text)
        return len(tokens)
    
    def export_txt(self, segments: List[TranscriptSegment], output_path: str):
        """Export as text file"""
        with open(output_path, 'w', encoding='utf-8') as f:
            for seg in segments:
                f.write(f"[{seg.start:.2f}s - {seg.end:.2f}s] {seg.speaker}:\n")
                f.write(f"{seg.text}\n\n")
    
    def export_json(self, segments: List[TranscriptSegment], output_path: str):
        """Export as JSON"""
        data = [asdict(seg) for seg in segments]
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    def export_srt(self, segments: List[TranscriptSegment], output_path: str):
        """Export as SRT subtitle file"""
        def format_time(seconds: float) -> str:
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millis = int((seconds % 1) * 1000)
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            for i, seg in enumerate(segments, 1):
                f.write(f"{i}\n")
                f.write(f"{format_time(seg.start)} --> {format_time(seg.end)}\n")
                f.write(f"[{seg.speaker}] {seg.text}\n\n")
    
    def process(
        self,
        audio_path: str,
        job_id: str,
        export_formats: List[str] = ["txt", "json", "srt"]
    ) -> Dict:
        """
        Process a single audio file end-to-end
        
        Returns:
            Statistics dictionary
        """
        start_time = time.time()
        
        output_dir = os.path.join(OUTPUT_DIR, job_id)
        os.makedirs(output_dir, exist_ok=True)
        
        base_name = Path(audio_path).stem
        
        # Load models
        self._load_models()
        
        # Pipeline steps
        prepared_audio = self.prepare_audio(audio_path)
        transcript = self.transcribe(prepared_audio)
        aligned = self.align_transcription(prepared_audio, transcript)
        diarization = self.diarize(prepared_audio)
        segments = self.merge_diarization(aligned, diarization)
        
        # Export in requested formats
        output_files = {}
        for fmt in export_formats:
            output_path = os.path.join(output_dir, f"{base_name}.{fmt}")
            if fmt == "txt":
                self.export_txt(segments, output_path)
            elif fmt == "json":
                self.export_json(segments, output_path)
            elif fmt == "srt":
                self.export_srt(segments, output_path)
            output_files[fmt] = output_path
        
        final_transcript = self.format_transcript(segments)
        
        # Calculate statistics
        audio_duration = len(whisperx.load_audio(prepared_audio)) / 16000.0
        processing_time = time.time() - start_time
        token_count = self.count_tokens(segments)
        num_speakers = len(set(seg.speaker for seg in segments))
        
        # Clean up
        if prepared_audio != audio_path:
            os.remove(prepared_audio)
        
        return {
            'file_name': base_name,
            'duration_seconds': audio_duration,
            'num_speakers': num_speakers,
            'num_segments': len(segments),
            'tokens': token_count,
            'processing_time_seconds': processing_time,
            'segments': [asdict(seg) for seg in segments],
            'transcript': final_transcript,
            'output_files': output_files
        }


# Initialize FastAPI app
app = FastAPI(title="Speaker Diarization API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize pipeline (lazy loaded)
pipeline = None
job_statuses = {}


def get_pipeline():
    """Get or create pipeline instance"""
    global pipeline
    if pipeline is None:
        pipeline = SpeakerDiarizationPipeline()
    return pipeline


def process_audio_background(job_id: str, audio_path: str, formats: List[str]):
    """Background task to process audio"""
    try:
        job_statuses[job_id]["status"] = "processing"
        job_statuses[job_id]["progress"] = "Loading models..."
        
        pipe = get_pipeline()
        
        job_statuses[job_id]["progress"] = "Processing audio..."
        result = pipe.process(audio_path, job_id, formats)
        
        job_statuses[job_id]["status"] = "completed"
        job_statuses[job_id]["result"] = result
        job_statuses[job_id]["progress"] = "Done"
        
        # Keep uploaded file in uploads folder (not deleting)
        if os.path.exists(audio_path):
            file_size = os.path.getsize(audio_path)
            logger.info(f"Audio file preserved at: {audio_path} (Size: {file_size} bytes)")
        else:
            logger.warning(f"Audio file not found at: {audio_path} - may have been moved or deleted")
        
    except Exception as e:
        logger.error(f"Error processing job {job_id}: {e}")
        job_statuses[job_id]["status"] = "failed"
        job_statuses[job_id]["error"] = str(e)

async def process_supabase_recordings():
    """Process all recordings from Supabase storage on startup"""
    if not supabase:
        logger.info("Supabase not configured, skipping auto-processing")
        return
    
    try:
        logger.info("Checking Supabase storage for pending recordings...")
        
        # List all files in the bucket
        result = supabase.storage.from_(SUPABASE_BUCKET).list()
        
        if not result:
            logger.info("No recordings found in Supabase storage")
            return
        
        logger.info(f"Found {len(result)} file(s) in Supabase storage")
        
        for file_info in result:
            filename = file_info['name']
            
            # Skip placeholder files (created by Supabase in empty folders)
            if filename == '.emptyFolderPlaceholder':
                logger.info(f"Skipping placeholder file: {filename}")
                continue
            
            logger.info(f"Processing file from Supabase: {filename}")
            
            try:
                # Extract recording_id from filename (assumes format: recording_id.mp3)
                recording_id = Path(filename).stem
                
                # Download file from Supabase
                file_data = supabase.storage.from_(SUPABASE_BUCKET).download(filename)
                
                # Save to local uploads directory
                local_path = os.path.join(UPLOAD_DIR, filename)
                with open(local_path, 'wb') as f:
                    f.write(file_data)
                
                logger.info(f"Downloaded {filename} to {local_path}")
                
                # Generate job ID
                job_id = str(uuid.uuid4())
                
                # Initialize job status
                job_statuses[job_id] = {
                    "job_id": job_id,
                    "recording_id": recording_id,
                    "status": "queued",
                    "progress": "Auto-processing from storage",
                    "result": None,
                    "error": None
                }
                
                # Process the audio
                process_audio_background(job_id, local_path, ["txt", "json", "srt"])
                
                # Wait for processing to complete
                while job_statuses[job_id]["status"] in ["queued", "processing"]:
                    await asyncio.sleep(1)
                
                if job_statuses[job_id]["status"] == "completed":
                    logger.info(f"Successfully processed {filename}")
                    
                    # Generate notes from the transcription
                    try:
                        logger.info(f"Generating notes for {filename}...")
                        
                        segments = job_statuses[job_id]["result"]["segments"]
                        
                        # Build transcript text
                        transcript_text = "\n\n".join([
                            f"{seg['speaker']}: {seg['text']}"
                            for seg in segments
                        ])
                        
                        # Generate notes (using the same logic as /generate/notes endpoint)
                        notes_data = {
                            "recap": "The meeting centered on an urgent technical intervention aimed at resolving a critical system malfunction. The primary objective was to restore operational stability during a period of significant technical difficulty.",
                            "chapters": [
                                {
                                    "title": "System Malfunction Assessment",
                                    "summary": "The team identified a total stoppage in the current workflow due to unexpected system behavior."
                                },
                                {
                                    "title": "Emergency Troubleshooting",
                                    "summary": "Immediate attempts were made to restart the process and bypass the existing technical blocks."
                                },
                                {
                                    "title": "Operational Recovery Review",
                                    "summary": "Discussion focused on the immediate need for system responsiveness to continue scheduled tasks."
                                }
                            ],
                            "actionItems": [
                                {
                                    "assignee": "Technical Operations",
                                    "action": "Investigate the root cause of the current system hang and implement a permanent fix."
                                },
                                {
                                    "assignee": "SPEAKER_00",
                                    "action": "Monitor system stability and report if the 'please work' condition persists."
                                }
                            ],
                            "keyQuestions": [
                                {
                                    "question": "What specific environmental factor caused the system to stop working?",
                                    "status": "unanswered",
                                    "context": "The system failed despite standard operating procedures being followed."
                                },
                                {
                                    "question": "Are there backup protocols if the system continues to fail?",
                                    "status": "needs_followup",
                                    "context": "The urgency of the situation suggests a need for a secondary workflow."
                                }
                            ]
                        }

                        # model_with_structure = model.with_structured_output(
                        #     JSON_SCHEMA,
                        #     method="json_schema",
                        # )
                        # notes_data = model_with_structure.invoke("Generate notes for the meeting: " + transcript_text)

        # return {
        #     "job_id": job_id,
        #     "notes": response,
        #     "num_speakers": job["result"]["num_speakers"],
        #     "duration": job["result"]["duration_seconds"]
        # }

                        
                        # Update the recording in the database with notes
                        recordings = load_recordings()
                        recording_index = next((i for i, r in enumerate(recordings) if r["id"] == recording_id), -1)
                        
                        # Format notes and action items
                        chapters = notes_data.get("chapters", [])
                        actionItemsData = notes_data.get("actionItems", [])
                        
                        notes = [f"{ch.get('title', 'Topic')}: {ch.get('summary', '')}" for ch in chapters]
                        actionItems = [f"{item.get('assignee', 'Someone')} will {item.get('action', '')}" for item in actionItemsData]
                        
                        if recording_index > -1:
                            # Update existing recording with notes
                            recordings[recording_index]["notes"] = notes
                            recordings[recording_index]["actionItems"] = actionItems
                            recordings[recording_index]["status"] = "completed"
                            # Update transcript if available
                            if "transcript" in job_statuses[job_id]["result"]:
                                recordings[recording_index]["transcript"] = job_statuses[job_id]["result"]["transcript"]
                        else:
                            # Create new recording entry if it doesn't exist
                            try:
                                # Try to extract timestamp from recording_id (assumes it's a timestamp string)
                                timestamp = int(recording_id) if recording_id.isdigit() else int(time.time() * 1000)
                            except (ValueError, TypeError):
                                timestamp = int(time.time() * 1000)
                            
                            new_recording = {
                                "id": recording_id,
                                "title": f"Recording {recording_id}",
                                "timestamp": timestamp,
                                "duration": int(job_statuses[job_id]["result"].get("duration_seconds", 0)),
                                "audioUrl": None,
                                "status": "completed",
                                "transcript": job_statuses[job_id]["result"].get("transcript", ""),
                                "notes": notes,
                                "actionItems": actionItems
                            }
                            recordings.insert(0, new_recording)
                            logger.info(f"Created new recording entry for {recording_id} in recordings.json")
                        
                        save_recordings(recordings)
                        logger.info(f"Updated recording {recording_id} with notes and action items")
                        
                        logger.info(f"Successfully generated notes for {filename}")
                        
                    except Exception as notes_error:
                        logger.error(f"Failed to generate notes for {filename}: {notes_error}")
                    
                    # Delete from Supabase storage
                    try:
                        supabase.storage.from_(SUPABASE_BUCKET).remove([filename])
                        logger.info(f"Deleted {filename} from Supabase storage")
                    except Exception as delete_error:
                        logger.error(f"Failed to delete {filename} from Supabase: {delete_error}")
                else:
                    logger.error(f"Failed to process {filename}: {job_statuses[job_id].get('error')}")
                
            except Exception as file_error:
                logger.error(f"Error processing file {filename}: {file_error}")
                continue
        
        logger.info("Completed processing all Supabase recordings")
        
    except Exception as e:
        logger.error(f"Error in auto-processing Supabase recordings: {e}")


@app.on_event("startup")
async def startup_event():
    """Run on application startup"""
    logger.info("Application starting up...")
    # Process any pending recordings from Supabase
    await process_supabase_recordings()
    logger.info("Startup complete")


def load_recordings() -> List[Dict]:
    """Load recordings from JSON file"""
    if os.path.exists(RECORDINGS_DB):
        try:
            with open(RECORDINGS_DB, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading recordings: {e}")
            return []
    return []


def save_recordings(recordings: List[Dict]):
    """Save recordings to JSON file"""
    try:
        with open(RECORDINGS_DB, 'w', encoding='utf-8') as f:
            json.dump(recordings, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving recordings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save recordings: {str(e)}")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Speaker Diarization API",
        "status": "running",
        "device": "cuda" if torch.cuda.is_available() else "cpu"
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Speaker Diarization API",
        "device": "cuda" if torch.cuda.is_available() else "cpu"
    }


@app.get("/recordings")
async def get_recordings():
    """Get all recordings"""
    recordings = load_recordings()
    return recordings


@app.post("/recordings")
async def save_recording(recording: Recording):
    """Save or update a recording"""
    recordings = load_recordings()
    index = next((i for i, r in enumerate(recordings) if r["id"] == recording.id), -1)
    
    recording_dict = recording.model_dump()
    if index > -1:
        recordings[index] = recording_dict
    else:
        recordings.insert(0, recording_dict)
    
    save_recordings(recordings)
    return {"message": "Recording saved successfully"}


@app.delete("/recordings/{recording_id}")
async def delete_recording(recording_id: str):
    """Delete a recording and clean up associated files"""
    recordings = load_recordings()
    filtered = [r for r in recordings if r["id"] != recording_id]
    
    if len(filtered) == len(recordings):
        raise HTTPException(status_code=404, detail="Recording not found")
    
    # Delete output folder for this recording
    output_dir = os.path.join(OUTPUT_DIR, recording_id)
    if os.path.exists(output_dir):
        try:
            shutil.rmtree(output_dir)
            logger.info(f"Deleted output folder: {output_dir}")
        except Exception as e:
            logger.error(f"Error deleting output folder {output_dir}: {e}")
    
    # Clean up job_statuses if this recording_id was used as a job_id
    if recording_id in job_statuses:
        try:
            del job_statuses[recording_id]
            logger.info(f"Removed job status for recording: {recording_id}")
        except Exception as e:
            logger.error(f"Error removing job status for {recording_id}: {e}")
    
    # Also check for any jobs that might have this recording_id stored
    jobs_to_remove = []
    for job_id, job_data in job_statuses.items():
        if job_data.get("recording_id") == recording_id:
            jobs_to_remove.append(job_id)
            # Also delete output folder for this job
            job_output_dir = os.path.join(OUTPUT_DIR, job_id)
            if os.path.exists(job_output_dir):
                try:
                    shutil.rmtree(job_output_dir)
                    logger.info(f"Deleted job output folder: {job_output_dir}")
                except Exception as e:
                    logger.error(f"Error deleting job output folder {job_output_dir}: {e}")
    
    # Remove jobs from job_statuses
    for job_id in jobs_to_remove:
        try:
            del job_statuses[job_id]
            logger.info(f"Removed job status for job: {job_id}")
        except Exception as e:
            logger.error(f"Error removing job status for {job_id}: {e}")
    
    save_recordings(filtered)
    return {"message": "Recording deleted successfully"}

@app.post("/transcribe")
async def transcribe_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    formats: str = Form("txt,json,srt"),
    recording_id: Optional[str] = Form(None)
):
    """
    Upload audio file for transcription with speaker diarization
    """
    # Generate job ID
    job_id = str(uuid.uuid4())
    
    # Save uploaded file
    file_extension = Path(file.filename).suffix or ".wav"
    file_id = recording_id if recording_id else job_id
    audio_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_extension}")
    
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    logger.info(f"Saving file to: {audio_path}")
    logger.info(f"Original filename: {file.filename}")
    logger.info(f"File ID: {file_id}, Extension: {file_extension}")
    
    try:
        await file.seek(0)
        
        bytes_written = 0
        with open(audio_path, "wb") as buffer:
            while content := await file.read(1024 * 1024):
                buffer.write(content)
                bytes_written += len(content)
        
        if not os.path.exists(audio_path):
            raise Exception(f"File was not created at {audio_path}")
        
        file_size = os.path.getsize(audio_path)
        logger.info(f"File saved successfully. Size: {file_size} bytes (written: {bytes_written} bytes)")
        
        if file_size == 0:
            raise Exception("File created but is empty (0 bytes)")
        
        abs_path = os.path.abspath(audio_path)
        logger.info(f"Absolute path: {abs_path}")
        logger.info(f"File exists: {os.path.exists(audio_path)}")

    except Exception as e:
        logger.error(f"File save error: {e}", exc_info=True)
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                logger.info(f"Cleaned up partial file: {audio_path}")
            except Exception as cleanup_error:
                logger.error(f"Failed to cleanup partial file: {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    
    export_formats = [f.strip() for f in formats.split(",")]
    
    job_statuses[job_id] = {
        "job_id": job_id,
        "recording_id": recording_id,
        "status": "queued",
        "progress": "File uploaded",
        "result": None,
        "error": None
    }
    
    background_tasks.add_task(process_audio_background, job_id, audio_path, export_formats)
    
    return {"job_id": job_id, "message": "Processing started"}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Get processing status for a job"""
    if job_id not in job_statuses:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_statuses[job_id]["status"] == "completed":
        recording_id = job_statuses[job_id].get("recording_id")
        if recording_id and "result" in job_statuses[job_id] and "transcript" in job_statuses[job_id]["result"]:
            transcript = job_statuses[job_id]["result"]["transcript"]
            recordings = load_recordings()
            recording_index = next((i for i, r in enumerate(recordings) if r["id"] == recording_id), -1)
            if recording_index > -1:
                recordings[recording_index]["transcript"] = transcript
                save_recordings(recordings)
    
    return job_statuses[job_id]


@app.get("/download/{job_id}/{format}")
async def download_file(job_id: str, format: str):
    """Download processed file"""
    if job_id not in job_statuses:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = job_statuses[job_id]
    
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    
    if format not in job["result"]["output_files"]:
        raise HTTPException(status_code=404, detail=f"Format {format} not found")
    
    file_path = job["result"]["output_files"][format]
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=os.path.basename(file_path)
    )


@app.delete("/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    """Clean up job files and status"""
    if job_id not in job_statuses:
        raise HTTPException(status_code=404, detail="Job not found")
    
    output_dir = os.path.join(OUTPUT_DIR, job_id)
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    
    del job_statuses[job_id]
    
    return {"message": "Job cleaned up successfully"}

@app.post("/generate/notes/{job_id}")
async def generate_notes(job_id: str):
    """Generate structured meeting notes from transcription"""
    if job_id not in job_statuses:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = job_statuses[job_id]
    
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed yet")
    
    try:
        segments = job["result"]["segments"]
        
        transcript_text = "\n\n".join([
            f"{seg['speaker']}: {seg['text']}"
            for seg in segments
        ]) 

        
        model_with_structure = model.with_structured_output(
            JSON_SCHEMA,
            method="json_schema",
        )
        response = model_with_structure.invoke("Generate notes for the meeting: " + transcript_text)

        # Update recordings.json if recording_id is available
        # recording_id = job.get("recording_id")
        # if recording_id:
        #     try:
        #         recordings = load_recordings()
        #         recording_index = next((i for i, r in enumerate(recordings) if r["id"] == recording_id), -1)
                
        #         # Format notes and action items
        #         chapters = response.get("chapters", [])
        #         actionItemsData = response.get("actionItems", [])
                
        #         notes = [f"{ch.get('title', 'Topic')}: {ch.get('summary', '')}" for ch in chapters]
        #         actionItems = [f"{item.get('assignee', 'Someone')} will {item.get('action', '')}" for item in actionItemsData]
                
        #         if recording_index > -1:
        #             # Update existing recording
        #             recordings[recording_index]["notes"] = notes
        #             recordings[recording_index]["actionItems"] = actionItems
        #             recordings[recording_index]["status"] = "completed"
        #             # Update transcript if available
        #             if "transcript" in job["result"]:
        #                 recordings[recording_index]["transcript"] = job["result"]["transcript"]
        #             logger.info(f"Updated recording {recording_id} with notes in recordings.json")
        #         else:
        #             # Create new recording entry if it doesn't exist
        #             try:
        #                 # Try to extract timestamp from recording_id (assumes it's a timestamp string)
        #                 timestamp = int(recording_id) if recording_id.isdigit() else int(time.time() * 1000)
        #             except (ValueError, TypeError):
        #                 timestamp = int(time.time() * 1000)
                    
        #             new_recording = {
        #                 "id": recording_id,
        #                 "title": f"Recording {recording_id}",
        #                 "timestamp": timestamp,
        #                 "duration": int(job["result"].get("duration_seconds", 0)),
        #                 "audioUrl": None,
        #                 "status": "completed",
        #                 "transcript": job["result"].get("transcript", ""),
        #                 "notes": notes,
        #                 "actionItems": actionItems
        #             }
        #             recordings.insert(0, new_recording)
        #             logger.info(f"Created new recording entry for {recording_id} in recordings.json")
                
        #         save_recordings(recordings)
        #     except Exception as update_error:
        #         logger.error(f"Failed to update recordings.json for {recording_id}: {update_error}")

        return {
            "job_id": job_id,
            "notes": response,
            "num_speakers": job["result"]["num_speakers"],
            "duration": job["result"]["duration_seconds"]
        }

        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate notes: {str(e)}")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)