import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Recording } from '../types';

type Folder = 'recordings' | 'fallback';

class SupabaseService {
  private supabase: SupabaseClient | null = null;
  private bucketName = 'audio-recordings';

  async initialize(): Promise<boolean> {
    try {
      const env = (import.meta as any).env || {};
      const url = env.VITE_SUPABASE_URL;
      const key = env.VITE_SUPABASE_ANON_KEY;

      if (!url || !key) {
        console.warn('Supabase credentials not configured');
        return false;
      }

      this.supabase = createClient(url, key);
      return true;
    } catch (error) {
      console.error('Failed to initialize Supabase:', error);
      return false;
    }
  }

  private async getClient(): Promise<SupabaseClient | null> {
    if (!this.supabase) {
      const initialized = await this.initialize();
      if (!initialized) return null;
    }
    return this.supabase;
  }

  /**
   * Upload audio blob.
   * @param folder 'recordings' for normal, 'fallback' when backend was unavailable.
   */
  async uploadAudio(blob: Blob, filename: string, folder: Folder = 'recordings'): Promise<string | null> {
    try {
      const client = await this.getClient();
      if (!client) throw new Error('Supabase client not available');

      const path = `${folder}/${filename}`;
      const { error } = await client.storage
        .from(this.bucketName)
        .upload(path, blob, { contentType: 'audio/mpeg', upsert: true });

      if (error) throw error;

      const { data: urlData } = client.storage.from(this.bucketName).getPublicUrl(path);
      console.log(`Audio uploaded [${folder}]:`, urlData.publicUrl);
      return urlData.publicUrl;
    } catch (error) {
      console.error('Supabase audio upload failed:', error);
      return null;
    }
  }

  /**
   * Upload recording metadata as a JSON sidecar alongside the audio.
   * Always stored in 'fallback/' — this is how we recover recordings after backend comes back.
   */
  async uploadMetadata(recording: Recording): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;

      const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
      const path = `fallback/${recording.id}.json`;
      const { error } = await client.storage
        .from(this.bucketName)
        .upload(path, blob, { contentType: 'application/json', upsert: true });

      if (error) throw error;
    } catch (error) {
      console.error('Supabase metadata upload failed:', error);
    }
  }

  /**
   * Download metadata sidecar for a recording in the fallback folder.
   */
  async downloadMetadata(id: string): Promise<Recording | null> {
    try {
      const client = await this.getClient();
      if (!client) return null;

      const { data, error } = await client.storage
        .from(this.bucketName)
        .download(`fallback/${id}.json`);

      if (error) throw error;
      return JSON.parse(await data.text()) as Recording;
    } catch {
      return null;
    }
  }

  /**
   * Upload full transcript text as a .txt file alongside the audio.
   * Stored at recordings/{id}.txt or fallback/{id}.txt.
   */
  async uploadTranscript(id: string, text: string, folder: Folder = 'recordings'): Promise<string | null> {
    try {
      const client = await this.getClient();
      if (!client) return null;

      const path = `${folder}/${id}.txt`;
      const blob = new Blob([text], { type: 'text/plain' });
      const { error } = await client.storage
        .from(this.bucketName)
        .upload(path, blob, { contentType: 'text/plain', upsert: true });

      if (error) throw error;

      const { data: urlData } = client.storage.from(this.bucketName).getPublicUrl(path);
      return urlData.publicUrl;
    } catch (error) {
      console.error('Supabase transcript upload failed:', error);
      return null;
    }
  }

  /**
   * Download audio blob from a given folder.
   */
  async downloadAudio(filename: string, folder: Folder = 'recordings'): Promise<Blob | null> {
    try {
      const client = await this.getClient();
      if (!client) return null;

      const { data, error } = await client.storage
        .from(this.bucketName)
        .download(`${folder}/${filename}`);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Failed to download audio from Supabase:', error);
      return null;
    }
  }

  /**
   * Move a recording from fallback/ to recordings/ (copies audio, deletes fallback files).
   * Returns the new public URL.
   */
  async promoteFromFallback(id: string): Promise<string | null> {
    try {
      const client = await this.getClient();
      if (!client) return null;

      // Download audio from fallback
      const blob = await this.downloadAudio(`${id}.mp3`, 'fallback');
      if (!blob) throw new Error('Audio not found in fallback');

      // Upload to recordings/
      const url = await this.uploadAudio(blob, `${id}.mp3`, 'recordings');
      if (!url) throw new Error('Failed to upload to recordings/');

      // Delete fallback copies
      await client.storage
        .from(this.bucketName)
        .remove([`fallback/${id}.mp3`, `fallback/${id}.json`]);

      console.log(`Promoted recording ${id} from fallback to recordings`);
      return url;
    } catch (error) {
      console.error('Failed to promote recording from fallback:', error);
      return null;
    }
  }

  /**
   * Delete audio (and metadata sidecar if present) from both folders.
   */
  async deleteAudio(filename: string, folder?: Folder): Promise<boolean> {
    try {
      const client = await this.getClient();
      if (!client) return false;

      const base = filename.replace(/\.mp3$/, '');
      const paths: string[] = folder
        ? [`${folder}/${filename}`, `${folder}/${base}.json`, `${folder}/${base}.txt`]
        : [
            `recordings/${filename}`,
            `recordings/${base}.txt`,
            `fallback/${filename}`,
            `fallback/${base}.json`,
          ];

      const { error } = await client.storage.from(this.bucketName).remove(paths);
      if (error) {
        console.error('Failed to delete from Supabase:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Supabase delete failed:', error);
      return false;
    }
  }

  /**
   * List recording IDs that have a metadata sidecar in fallback/ (i.e. need recovery).
   */
  async listFallbackIds(): Promise<string[]> {
    try {
      const client = await this.getClient();
      if (!client) return [];

      const { data, error } = await client.storage
        .from(this.bucketName)
        .list('fallback');

      if (error) throw error;

      return data
        .filter(f => f.name.endsWith('.json'))
        .map(f => f.name.replace(/\.json$/, ''));
    } catch (error) {
      console.error('Failed to list fallback files:', error);
      return [];
    }
  }

  isAvailable(): boolean {
    return !!this.supabase;
  }
}

export const supabaseService = new SupabaseService();
