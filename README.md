# EchoNote - AI-Powered Meeting Transcription & Analysis

EchoNote is an intelligent audio recording and transcription application that automatically transcribes meetings, identifies speakers, and generates structured notes with action items using AI.

## 🎯 Features

- **🎤 Real-time Audio Recording** - Capture audio directly from your browser
- **🎙️ Speaker Diarization** - Automatically identifies and labels different speakers
- **📝 AI-Generated Notes** - Uses Google Gemini to create structured meeting summaries
- **✅ Action Items Extraction** - Automatically identifies and formats action items from conversations
- **☁️ Cloud Storage** - Automatic backup to Supabase Storage when backend is unavailable
- **🔍 Search Functionality** - Search through your recordings by title or transcript
- **📱 Responsive Design** - Modern, dark-themed UI that works on all devices

## 🛠️ Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite** for build tooling
- **Lucide React** for icons
- **Supabase** for cloud storage fallback

### Backend
- **FastAPI** - Python web framework
- **WhisperX** - Advanced speech recognition with word-level timestamps
- **pyannote.audio** - Speaker diarization pipeline
- **Google Gemini 3 Flash** - AI-powered note generation via LangChain
- **Supabase** - Cloud storage integration

## 📋 Prerequisites

- **Python 3.8+**
- **Node.js 18+** and npm
- **FFmpeg** - Required for audio processing
- **CUDA-capable GPU** (optional but recommended for faster processing)
- **Google API Key** - For Gemini AI features
- **Supabase Account** (optional, for cloud storage)

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ReadAI
```

### 2. Backend Setup

```bash
cd Backend

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install PyTorch with CUDA support (if you have a compatible GPU)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install other dependencies
pip install -r requirements.txt
```

**Note:** For CPU-only installation, install PyTorch without CUDA:
```bash
pip install torch torchvision torchaudio
```

### 3. Frontend Setup

```bash
cd ReadAI

# Install dependencies
npm install
```

### 4. Environment Variables

Create a `.env` file in the `Backend` directory:

```env
# Supabase Configuration (optional)
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# Google Gemini API Key (required for note generation)
GOOGLE_API_KEY=your_google_api_key
```

Create a `.env` file in the `ReadAI` directory:

```env
# Supabase Configuration (optional, for cloud storage fallback)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Backend API URL
VITE_API_URL=http://localhost:8000
```

## 🏃 Running the Application

### Start the Backend Server

```bash
cd Backend
python main.py
```

The API will be available at `http://localhost:8000`

### Start the Frontend Development Server

```bash
cd ReadAI
npm run dev
```

The frontend will be available at `http://localhost:5173` (or the port Vite assigns)

## 📁 Project Structure

```
ReadAI/
├── Backend/
│   ├── main.py              # FastAPI application
│   ├── requirements.txt     # Python dependencies
│   ├── uploads/             # Temporary audio file storage
│   ├── outputs/             # Processed transcription outputs
│   └── recordings.json       # Recording metadata database
│
├── ReadAI/
│   ├── src/                 # React source files
│   ├── components/           # React components
│   │   ├── Recorder.tsx     # Audio recording component
│   │   └── RecordingCard.tsx # Recording list item component
│   ├── services/             # API and service integrations
│   │   ├── apiService.ts    # Backend API client
│   │   ├── SupabaseService.ts # Cloud storage service
│   │   └── audioConverter.ts # Audio format conversion
│   ├── App.tsx              # Main application component
│   ├── types.ts             # TypeScript type definitions
│   └── package.json         # Node.js dependencies
│
└── README.md                # This file
```

## 🔌 API Endpoints

### Recordings
- `GET /recordings` - Get all recordings
- `POST /recordings` - Save a new recording
- `DELETE /recordings/{id}` - Delete a recording

### Transcription
- `POST /transcribe` - Upload audio file for transcription
  - Parameters: `file` (audio file), `formats` (txt,json,srt), `recording_id` (optional)
  - Returns: `job_id` for tracking

- `GET /status/{job_id}` - Get transcription job status
  - Returns: Processing status, progress, and results

- `GET /download/{job_id}/{format}` - Download processed file (txt, json, or srt)

### AI Generation
- `POST /generate/notes/{job_id}` - Generate meeting notes from transcription
  - Returns: Structured notes with recap, chapters, action items, and key questions

### Health
- `GET /` - Service information
- `GET /health` - Health check endpoint

## 🎨 Usage

1. **Start Recording**: Click the record button in the main interface
2. **Stop Recording**: Click stop when finished
3. **Name Your Recording**: Enter a descriptive name
4. **Process Audio**: Click "Analyze Audio" to start transcription and AI analysis
5. **View Results**: Once processing completes, view the transcript, notes, and action items
6. **Search**: Use the search bar to find recordings by title or content
7. **Edit Titles**: Hover over a recording title and click the edit icon to rename

## 🔒 Security Notes

- All API keys and sensitive credentials are loaded from environment variables
- Never commit `.env` files to version control
- Supabase anon keys are safe for client-side use (they have Row Level Security)
- Google API keys should be kept secure and not exposed in client-side code

## 🐛 Troubleshooting

### Backend Issues

**CUDA/GPU not detected:**
- The application will automatically fall back to CPU processing
- CPU processing is slower but functional

**FFmpeg not found:**
- Install FFmpeg and ensure it's in your system PATH
- Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- macOS: `brew install ffmpeg`
- Linux: `sudo apt-get install ffmpeg`

**Model download issues:**
- First run will download WhisperX and pyannote models (several GB)
- Ensure stable internet connection
- Models are cached locally after first download

### Frontend Issues

**Backend connection failed:**
- Check that backend is running on port 8000
- Verify `VITE_API_URL` in frontend `.env` file
- Application will use Supabase storage as fallback

**Supabase errors:**
- Supabase is optional - application works without it
- If configured, verify credentials in `.env` file

## 📝 Development

### Building for Production

**Frontend:**
```bash
cd ReadAI
npm run build
```

**Backend:**
The backend runs directly with Python. For production, consider using:
- Gunicorn or uvicorn with multiple workers
- Process managers like PM2 or systemd
- Reverse proxy (nginx) for serving static files

### Code Style

- Frontend: ESLint is configured - run `npm run lint` to check
- Backend: Follow PEP 8 Python style guide

## 📄 License

[Add your license here]

## 🤝 Contributing

[Add contribution guidelines here]

## 🙏 Acknowledgments

- [WhisperX](https://github.com/m-bain/whisperX) for transcription
- [pyannote.audio](https://github.com/pyannote/pyannote-audio) for speaker diarization
- [Google Gemini](https://deepmind.google/technologies/gemini/) for AI-powered analysis
- [Supabase](https://supabase.com/) for cloud storage

---

**Note:** This application processes audio locally and requires significant computational resources. For production use, consider deploying to a server with GPU support for optimal performance.

