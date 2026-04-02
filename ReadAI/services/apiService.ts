
import { Recording, GeminiResponse, LanguageAnalysisResult, MetricsHistoryPoint, SlangEntry, RecurringCorrection } from "../types";
import { supabaseService } from "./SupabaseService";

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL;

async function isBackendAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const apiService = {
  /**
   * Fetches all recordings from the backend.
   * Returns empty list if backend is unavailable — fallback recordings are
   * loaded separately via processFallbackRecordings().
   */
  async getRecordings(): Promise<Recording[]> {
    try {
      const available = await isBackendAvailable();
      if (!available) return [];

      const response = await fetch(`${API_BASE_URL}/recordings`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to fetch recordings: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching recordings:', error);
      return [];
    }
  },

  /**
   * Persists a single recording.
   *
   * When audioBlob is provided (new recording):
   *   - Backend available   → audio to Supabase 'recordings/', metadata to backend
   *   - Backend unavailable → audio + metadata JSON sidecar to Supabase 'fallback/'
   *
   * When no audioBlob (metadata update):
   *   - Backend available   → update backend
   *   - Backend unavailable → update metadata JSON sidecar in 'fallback/'
   */
  async saveRecording(recording: Recording, audioBlob?: Blob): Promise<Recording> {
    try {
      const available = await isBackendAvailable();

      if (!available) {
        if (audioBlob) {
          const url = await supabaseService.uploadAudio(audioBlob, `${recording.id}.mp3`, 'fallback');
          if (url) recording.audioUrl = url;
        }
        // Always persist metadata sidecar in fallback/ so startup recovery can find it
        await supabaseService.uploadMetadata(recording);
        return recording;
      }

      // Backend available
      if (audioBlob) {
        const url = await supabaseService.uploadAudio(audioBlob, `${recording.id}.mp3`, 'recordings');
        if (url) recording.audioUrl = url;
      }

      const response = await fetch(`${API_BASE_URL}/recordings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recording),
      });
      if (!response.ok) throw new Error(`Failed to save recording: ${response.statusText}`);

    } catch (error) {
      console.error('Error saving recording:', error);
      // If backend call failed but we had a blob, move it to fallback
      if (audioBlob) {
        const url = await supabaseService.uploadAudio(audioBlob, `${recording.id}.mp3`, 'fallback');
        if (url) recording.audioUrl = url;
      }
      await supabaseService.uploadMetadata(recording);
    }

    return recording;
  },

  /**
   * Deletes a recording from backend and Supabase (both folders + metadata sidecars).
   */
  async deleteRecording(id: string): Promise<void> {
    await supabaseService.deleteAudio(`${id}.mp3`);

    try {
      const available = await isBackendAvailable();
      if (!available) return;

      const response = await fetch(`${API_BASE_URL}/recordings/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to delete recording: ${response.statusText}`);
    } catch (error) {
      console.error('Error deleting recording from backend:', error);
    }
  },

  /**
   * Sends audio to the backend for transcription and note generation.
   * Throws if backend is unavailable — caller should leave recording in 'error' status
   * so it can be retried on next startup via processFallbackRecordings().
   */
  async processAudio(mimeType: string, recordingId: string, audioBlob: Blob): Promise<GeminiResponse> {
    const available = await isBackendAvailable();
    if (!available) {
      throw new Error('BACKEND_UNAVAILABLE');
    }

    // Step 1: Transcribe
    const formData = new FormData();
    formData.append('file', new File([audioBlob], `${recordingId}.mp3`, { type: mimeType }));
    formData.append('formats', 'txt,json');
    formData.append('recording_id', recordingId);

    const transcribeResponse = await fetch(`${API_BASE_URL}/transcribe`, {
      method: 'POST',
      body: formData,
    });
    if (!transcribeResponse.ok) {
      throw new Error(`Failed to upload audio: ${transcribeResponse.statusText}`);
    }

    const { job_id: jobId } = await transcribeResponse.json();

    // Step 2: Poll for completion
    let status = 'queued';
    let attempts = 0;
    while (status !== 'completed' && status !== 'failed' && attempts < 200) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const statusResponse = await fetch(`${API_BASE_URL}/status/${jobId}`);
      if (!statusResponse.ok) throw new Error(`Failed to check status: ${statusResponse.statusText}`);
      const statusData = await statusResponse.json();
      status = statusData.status;
      attempts++;
      if (status === 'failed') throw new Error(statusData.error || 'Processing failed');
    }
    if (status !== 'completed') throw new Error('Processing timed out');

    // Step 3: Check for empty transcript and extract full text
    const finalStatus = await (await fetch(`${API_BASE_URL}/status/${jobId}`)).json();
    const segments = finalStatus.result?.segments || [];
    const hasContent = segments.some((seg: any) => (seg.text || '').trim().length > 0);

    if (!hasContent) {
      await this.deleteRecording(recordingId).catch(() => {});
      throw new Error('EMPTY_AUDIO');
    }

    const formatTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const mm = String(m).padStart(2, '0');
      const ss = String(s).padStart(2, '0');
      return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    };

    const fullTranscript = segments
      .filter((seg: any) => (seg.text || '').trim())
      .map((seg: any) => {
        const timestamp = `[${formatTime(seg.start ?? 0)}]`;
        const speaker = seg.speaker ? `${seg.speaker}: ` : '';
        return `${timestamp} ${speaker}${seg.text.trim()}`;
      })
      .join('\n');

    // Upload transcript to Supabase Storage as recordings/{id}.txt
    const transcriptUrl = await supabaseService.uploadTranscript(recordingId, fullTranscript, 'recordings');

    // Step 4: Generate notes
    const notesResponse = await fetch(`${API_BASE_URL}/generate/notes/${jobId}`, { method: 'POST' });
    if (!notesResponse.ok) {
      const err = await notesResponse.json().catch(() => ({}));
      if (notesResponse.status === 400 && err.detail?.includes('empty')) {
        await this.deleteRecording(recordingId).catch(() => {});
        throw new Error('EMPTY_AUDIO');
      }
      throw new Error(`Failed to generate notes: ${notesResponse.statusText}`);
    }

    const notesData = (await notesResponse.json()).notes;
    return {
      summary: notesData.recap || "Meeting processed successfully",
      notes: (notesData.chapters || []).map((ch: any) => `${ch.title || "Topic"}: ${ch.summary || ""}`),
      actionItems: (notesData.actionItems || []).map((item: any) => `${item.assignee || "Someone"} will ${item.action || ""}`),
      transcriptUrl: transcriptUrl ?? undefined,
    };
  },

  /**
   * Language analysis pipeline (toggle ON).
   * Transcribes the audio then runs the full language improvement analysis.
   */
  async processAudioForAnalysis(
    mimeType: string,
    recordingId: string,
    audioBlob: Blob,
    durationSeconds: number,
  ): Promise<LanguageAnalysisResult> {
    const available = await isBackendAvailable();
    if (!available) throw new Error('BACKEND_UNAVAILABLE');

    // Step 1: Transcribe (same as processAudio)
    const formData = new FormData();
    formData.append('file', new File([audioBlob], `${recordingId}.mp3`, { type: mimeType }));
    formData.append('formats', 'txt,json');
    formData.append('recording_id', recordingId);

    const transcribeResponse = await fetch(`${API_BASE_URL}/transcribe`, {
      method: 'POST',
      body: formData,
    });
    if (!transcribeResponse.ok) throw new Error(`Failed to upload audio: ${transcribeResponse.statusText}`);

    const { job_id: jobId } = await transcribeResponse.json();

    // Step 2: Poll for completion
    let status = 'queued';
    let attempts = 0;
    while (status !== 'completed' && status !== 'failed' && attempts < 200) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const statusResponse = await fetch(`${API_BASE_URL}/status/${jobId}`);
      if (!statusResponse.ok) throw new Error(`Failed to check status: ${statusResponse.statusText}`);
      const statusData = await statusResponse.json();
      status = statusData.status;
      attempts++;
      if (status === 'failed') throw new Error(statusData.error || 'Processing failed');
    }
    if (status !== 'completed') throw new Error('Processing timed out');

    // Step 3: Extract plain transcript text from segments
    const finalStatus = await (await fetch(`${API_BASE_URL}/status/${jobId}`)).json();
    const segments: any[] = finalStatus.result?.segments || [];
    const hasContent = segments.some((seg: any) => (seg.text || '').trim().length > 0);

    if (!hasContent) {
      await this.deleteRecording(recordingId).catch(() => {});
      throw new Error('EMPTY_AUDIO');
    }

    // Strip speaker labels — language analysis needs clean text only
    const plainTranscript = segments
      .filter((seg: any) => (seg.text || '').trim())
      .map((seg: any) => seg.text.trim())
      .join(' ');

    // Step 4: Run language analysis pipeline
    const analysisResponse = await fetch(`${API_BASE_URL}/api/sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: plainTranscript, duration_seconds: durationSeconds }),
    });
    if (!analysisResponse.ok) {
      const err = await analysisResponse.json().catch(() => ({}));
      throw new Error(err.detail || `Language analysis failed: ${analysisResponse.statusText}`);
    }

    return await analysisResponse.json() as LanguageAnalysisResult;
  },

  async getMetricsHistory(): Promise<MetricsHistoryPoint[]> {
    const response = await fetch(`${API_BASE_URL}/api/metrics/history`);
    if (!response.ok) throw new Error('Failed to fetch metrics history');
    return response.json();
  },

  async getRecurringCorrections(): Promise<RecurringCorrection[]> {
    const response = await fetch(`${API_BASE_URL}/api/corrections/recurring`);
    if (!response.ok) throw new Error('Failed to fetch recurring corrections');
    return response.json();
  },

  async getSlangBank(): Promise<SlangEntry[]> {
    const response = await fetch(`${API_BASE_URL}/api/slang`);
    if (!response.ok) throw new Error('Failed to fetch slang bank');
    return response.json();
  },

  /**
   * Called on startup. Finds any recordings in Supabase 'fallback/' that haven't been
   * processed yet, attempts to process them, and promotes them to 'recordings/' on success.
   *
   * @param onUpdate  Called for each recording as its status changes, so the UI can update live.
   */
  async processFallbackRecordings(onUpdate: (recording: Recording) => void): Promise<void> {
    const available = await isBackendAvailable();
    if (!available) return;

    const fallbackIds = await supabaseService.listFallbackIds();
    if (fallbackIds.length === 0) return;

    console.log(`Found ${fallbackIds.length} fallback recording(s) to recover:`, fallbackIds);

    for (const id of fallbackIds) {
      // Load stored metadata
      const metadata = await supabaseService.downloadMetadata(id);
      if (!metadata) {
        console.warn(`No metadata sidecar found for fallback recording ${id}, skipping`);
        continue;
      }

      // Show as "processing" in the UI immediately
      const recovering: Recording = { ...metadata, status: 'processing' };
      onUpdate(recovering);

      try {
        // Download the audio blob from fallback/
        const blob = await supabaseService.downloadAudio(`${id}.mp3`, 'fallback');
        if (!blob) throw new Error(`Audio blob missing for ${id}`);

        // Process through backend — use the same pipeline that was active when recorded
        const newAudioUrl = await supabaseService.promoteFromFallback(id);
        let completed: Recording;

        if (metadata.useLanguageAnalysis) {
          const analysis = await this.processAudioForAnalysis('audio/mpeg', id, blob, metadata.duration);
          completed = {
            ...metadata,
            status: 'completed',
            audioUrl: newAudioUrl ?? metadata.audioUrl,
            languageAnalysis: analysis,
          };
        } else {
          const result = await this.processAudio('audio/mpeg', id, blob);
          completed = {
            ...metadata,
            status: 'completed',
            audioUrl: newAudioUrl ?? metadata.audioUrl,
            transcript: result.summary,
            notes: result.notes,
            actionItems: result.actionItems,
          };
        }

        await this.saveRecording(completed);
        onUpdate(completed);

        console.log(`Successfully recovered fallback recording: ${id}`);
      } catch (err) {
        if (err instanceof Error && err.message === 'EMPTY_AUDIO') {
          // Recording had no audio content — delete it entirely
          await this.deleteRecording(id);
          onUpdate({ ...metadata, status: 'error' });
        } else {
          console.error(`Failed to recover fallback recording ${id}:`, err);
          // Leave in fallback — will retry next startup
          onUpdate({ ...metadata, status: 'error' });
        }
      }
    }
  },
};
