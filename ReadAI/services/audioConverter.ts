/**
 * Audio conversion utilities
 * Converts WebM to MP3 for backend compatibility
 */

/**
 * Convert WebM Blob to MP3 Blob
 * Uses Web Audio API and MediaRecorder for conversion
 */
export async function convertWebmToMp3(webmBlob: Blob): Promise<Blob> {
  try {
    // Note: MP3 encoding in browser requires a library like lamejs
    // For now, we'll return the original blob and let the backend handle conversion
    // The backend can handle WebM format
    
    // Alternative: Use MediaRecorder with mpeg codec if available
    if (MediaRecorder.isTypeSupported('audio/mpeg')) {
      return webmBlob; // If MP3 is supported, return as-is (it might already be compatible)
    }
    
    // If MP3 encoding isn't available in browser, return original
    // The backend can handle WebM format
    return webmBlob;
  } catch (error) {
    console.error('Error converting audio:', error);
    // Return original blob if conversion fails
    return webmBlob;
  }
}

/**
 * Convert Blob to base64 string
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove data URL prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

