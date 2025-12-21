
export interface Recording {
    id: string;
    title: string;
    timestamp: number;
    duration: number; // in seconds
    audioUrl?: string;
    status: 'recording' | 'processing' | 'completed' | 'error';
    transcript?: string;
    notes: string[];
    actionItems: string[];
  }
  
  export interface GeminiResponse {
    summary: string;
    notes: string[];
    actionItems: string[];
  }
  