
import { Recording, GeminiResponse } from "../types";
import { supabaseService } from "./SupabaseService";

// Backend API base URL
const API_BASE_URL = (import.meta as any).env?.VITE_API_URL;

/**
 * Check if backend is available
 */
async function isBackendAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    return response.ok;
  } catch (error) {
    console.warn('Backend not available:', error);
    return false;
  }
}

/**
 * Service to handle data persistence and external API calls.
 */
export const apiService = {
  /**
   * Fetches all recordings from the backend
   */
  async getRecordings(): Promise<Recording[]> {
    try {
      const available = await isBackendAvailable();
      if (!available) {
        // Fallback to localStorage
        const saved = localStorage.getItem('echo-recordings');
        return saved ? JSON.parse(saved) : [];
      }

      const response = await fetch(`${API_BASE_URL}/recordings`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch recordings: ${response.statusText}`);
      }

      const recordings = await response.json();
      return recordings;
    } catch (error) {
      console.error('Error fetching recordings:', error);
      // Fallback to localStorage
      const saved = localStorage.getItem('echo-recordings');
      return saved ? JSON.parse(saved) : [];
    }
  },

  /**
   * Persists a single recording to the backend
   * If backend is unavailable and audioBlob is provided, stores it in Mega.nz
   */
  async saveRecording(recording: Recording, audioBlob?: Blob): Promise<void> {
    const saveFallback = async () => {
      // Try to store blob in Mega.nz if provided
      if (audioBlob) {
        try {
          const filename = `${recording.id}.mp3`;
          const megaUrl = await supabaseService.uploadAudio(audioBlob, filename);
          if (megaUrl) {
            recording.audioUrl = megaUrl;
            console.log('Audio stored in Mega.nz:', megaUrl);
          }
        } catch (megaError) {
          console.error('Mega.nz upload failed:', megaError);
        }
      }
      
      // Fallback to localStorage
      // const saved = localStorage.getItem('echo-recordings');
      // const recordings: Recording[] = saved ? JSON.parse(saved) : [];
      // const index = recordings.findIndex(r => r.id === recording.id);
      
      // if (index > -1) {
      //   recordings[index] = recording;
      // } else {
      //   recordings.unshift(recording);
      // }
      
      // localStorage.setItem('echo-recordings', JSON.stringify(recordings));
    };

    try {
      const available = await isBackendAvailable();
      if (!available) {
        await saveFallback();
        return;
      }

      const response = await fetch(`${API_BASE_URL}/recordings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(recording),
      });

      if (!response.ok) {
        throw new Error(`Failed to save recording: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error saving recording:', error);
      await saveFallback();
    }
  },

  /**
   * Deletes a recording from the backend
   */
  async deleteRecording(id: string): Promise<void> {
    try {
      const available = await isBackendAvailable();
      if (!available) {
        // Fallback to localStorage
        const saved = localStorage.getItem('echo-recordings');
        if (saved) {
          const recordings: Recording[] = JSON.parse(saved);
          const filtered = recordings.filter(r => r.id !== id);
          localStorage.setItem('echo-recordings', JSON.stringify(filtered));
        }
        return;
      }

      const response = await fetch(`${API_BASE_URL}/recordings/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete recording: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error deleting recording:', error);
      // Fallback to localStorage
      const saved = localStorage.getItem('echo-recordings');
      if (saved) {
        const recordings: Recording[] = JSON.parse(saved);
        const filtered = recordings.filter(r => r.id !== id);
        localStorage.setItem('echo-recordings', JSON.stringify(filtered));
      }
    }
  },

  /**
   * Sends audio to the backend for processing
   * Uses /transcribe endpoint, then polls for completion, then calls /generate/notes
   * Falls back to Mega.nz if backend is unavailable
   */
  async processAudio(mimeType: string, recordingId: string, audioBlob: Blob): Promise<GeminiResponse> {
    try {
      const available = await isBackendAvailable();
      
      if (!available) {
        // Backend unavailable - store in Mega.nz
        if (audioBlob) {
          const filename = `${recordingId}.mp3`;
          const megaUrl = await supabaseService.uploadAudio(audioBlob, filename);
          
          if (megaUrl) {
            console.log('Audio stored in Mega.nz:', megaUrl);
            // Return a placeholder response since we can't process without backend
            return {
              summary: "Audio file stored in cloud storage. Processing will resume when backend is available.",
              notes: [],
              actionItems: []
            };
          }
        }
        
        throw new Error('Backend unavailable and Mega.nz upload failed');
      }

      // Step 1: Upload audio using /transcribe endpoint
      const formData = new FormData();
      const audioFile = new File([audioBlob!], `${recordingId}.mp3`, { type: mimeType });
      formData.append('file', audioFile);
      formData.append('formats', 'txt,json');
      formData.append('recording_id', recordingId);

      const transcribeResponse = await fetch(`${API_BASE_URL}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!transcribeResponse.ok) {
        throw new Error(`Failed to upload audio: ${transcribeResponse.statusText}`);
      }

      const transcribeResult = await transcribeResponse.json();
      const jobId = transcribeResult.job_id;

      // Step 2: Poll for completion
      let status = 'queued';
      let attempts = 0;
      const maxAttempts = 200; // 5 minutes max (1 second intervals)
      
      while (status !== 'completed' && status !== 'failed' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 second
        
        const statusResponse = await fetch(`${API_BASE_URL}/status/${jobId}`);
        if (!statusResponse.ok) {
          throw new Error(`Failed to check status: ${statusResponse.statusText}`);
        }
        
        const statusData = await statusResponse.json();
        status = statusData.status;
        attempts++;
        
        if (status === 'failed') {
          throw new Error(statusData.error || 'Processing failed');
        }
      }

      if (status !== 'completed') {
        throw new Error('Processing timed out');
      }

      // Check the transcript and if it is empty, delete the recording
      const finalStatusResponse = await fetch(`${API_BASE_URL}/status/${jobId}`);
      if (!finalStatusResponse.ok) {
        throw new Error(`Failed to get final status: ${finalStatusResponse.statusText}`);
      }
      
      const finalStatusData = await finalStatusResponse.json();
      const segments = finalStatusData.result?.segments || [];
      
      // Check if transcript is empty (no segments or all segments have empty text)
      const hasValidTranscript = segments.length > 0 && segments.some((seg: any) => {
        const text = seg.text || '';
        return text.trim().length > 0;
      });
      
      if (!hasValidTranscript) {
        // Delete the recording since transcript is empty
        try {
          await this.deleteRecording(recordingId);
          console.log(`Deleted empty recording: ${recordingId}`);
        } catch (deleteError) {
          console.error('Failed to delete empty recording:', deleteError);
        }
        
        // Throw a specific error that the frontend can handle
        throw new Error('EMPTY_AUDIO');
      }

      // Step 3: Generate notes using /generate/notes endpoint
      const notesResponse = await fetch(`${API_BASE_URL}/generate/notes/${jobId}`, {
        method: 'POST',
      });

      if (!notesResponse.ok) {
        const errorData = await notesResponse.json().catch(() => ({}));
        // If recording was deleted due to empty audio, throw a specific error
        if (notesResponse.status === 400 && errorData.detail?.includes('empty')) {
          // Try to delete the recording if backend hasn't already
          try {
            await this.deleteRecording(recordingId);
          } catch (deleteError) {
            console.error('Failed to delete empty recording:', deleteError);
          }
          throw new Error('EMPTY_AUDIO');
        }
        throw new Error(`Failed to generate notes: ${notesResponse.statusText}`);
      }

      const notesResult = await notesResponse.json();
      const notesData = notesResult.notes;

      // Extract summary, notes, and actionItems from the response
      const summary = notesData.recap || "";
      const chapters = notesData.chapters || [];
      const actionItemsData = notesData.actionItems || [];

      // Format notes from chapters
      const notes = chapters.map((ch: any) => 
        `${ch.title || "Topic"}: ${ch.summary || ""}`
      );

      // Format action items
      const actionItems = actionItemsData.map((item: any) => {
        const assignee = item.assignee || "Someone";
        const action = item.action || "";
        return `${assignee} will ${action}`;
      });

      return {
        summary: summary || "Meeting processed successfully",
        notes: notes,
        actionItems: actionItems,
      };
    } catch (error) {
      console.error('Error processing audio:', error);
      
      // If backend fails during processing, try to save to Mega.nz
      if (audioBlob) {
        try {
          const filename = `${recordingId}.mp3`;
          const megaUrl = await supabaseService.uploadAudio(audioBlob, filename);
          if (megaUrl) {
            console.log('Audio stored in Mega.nz as fallback:', megaUrl);
          }
        } catch (megaError) {
          console.error('Mega.nz fallback also failed:', megaError);
        }
      }
      
      throw error;
    }
  }
};
