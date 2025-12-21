import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase service for storing audio files when backend is unavailable
 */

class SupabaseService {
  private supabase: SupabaseClient | null = null;
  private bucketName = 'audio-recordings';

  /**
   * Initialize Supabase client
   */
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
      console.log('Supabase initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize Supabase:', error);
      return false;
    }
  }

  /**
   * Upload audio file to Supabase Storage
   * Returns the public URL
   */
  async uploadAudio(blob: Blob, filename: string): Promise<string | null> {
    try {
      // Initialize if not already done
      if (!this.supabase) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Supabase not initialized');
        }
      }

      if (!this.supabase) {
        throw new Error('Supabase client not available');
      }

      // Upload file to Supabase Storage
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(filename, blob, {
          contentType: 'audio/mpeg',
          upsert: true, // Overwrite if exists
        });

      if (error) {
        throw error;
      }

      // Get public URL
      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filename);

      console.log('File uploaded to Supabase:', urlData.publicUrl);
      return urlData.publicUrl;

    } catch (error) {
      console.error('Supabase upload failed:', error);
      return null;
    }
  }

  /**
   * Delete audio file from Supabase Storage
   */
  async deleteAudio(filename: string): Promise<boolean> {
    try {
      if (!this.supabase) {
        await this.initialize();
      }

      if (!this.supabase) {
        return false;
      }

      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .remove([filename]);

      if (error) {
        console.error('Failed to delete from Supabase:', error);
        return false;
      }

      console.log('File deleted from Supabase:', filename);
      return true;

    } catch (error) {
      console.error('Supabase delete failed:', error);
      return false;
    }
  }

  /**
   * Download audio file from Supabase Storage
   */
  async downloadAudio(filename: string): Promise<Blob | null> {
    try {
      if (!this.supabase) {
        await this.initialize();
      }

      if (!this.supabase) {
        return null;
      }

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .download(filename);

      if (error) {
        throw error;
      }

      return data;

    } catch (error) {
      console.error('Failed to download from Supabase:', error);
      return null;
    }
  }

  /**
   * Check if Supabase is available
   */
  isAvailable(): boolean {
    return !!this.supabase;
  }

  /**
   * List all audio files in Supabase Storage
   */
  async listAudio(): Promise<string[]> {
    try {
      if (!this.supabase) {
        await this.initialize();
      }

      if (!this.supabase) {
        return [];
      }

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .list();

      if (error) {
        throw error;
      }

      return data.map(file => file.name);

    } catch (error) {
      console.error('Failed to list files from Supabase:', error);
      return [];
    }
  }
}

export const supabaseService = new SupabaseService();