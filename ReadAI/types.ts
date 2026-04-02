
export interface Recording {
    id: string;
    title: string;
    timestamp: number;
    duration: number; // in seconds
    audioUrl?: string;
    transcriptUrl?: string;
    status: 'recording' | 'processing' | 'completed' | 'error';
    transcript?: string;
    notes: string[];
    actionItems: string[];
    useLanguageAnalysis?: boolean;
    languageAnalysis?: LanguageAnalysisResult;
  }

  export interface GeminiResponse {
    summary: string;
    notes: string[];
    actionItems: string[];
    transcriptUrl?: string;
  }

  export interface LanguageCorrection {
    whatWasSaid: string;
    whatToSay: string;
    why: string;
    register: string;
    contextSentence: string;
    isRecurring: boolean;
  }

  export interface LanguageAnalysisResult {
    sessionId: number;
    overallScore: number;
    fluencyScore: number;
    naturalnessScore: number;
    fillerRate: number;
    avgSentenceLength: number;
    vocabularyRichness: number;
    corrections: LanguageCorrection[];
    strengths: string[];
    focusAreas: string[];
    progressVsLastSession: string;
    _plainTranscript?: string;
  }

  export interface MetricsHistoryPoint {
    id: number;
    session_date: string;
    overall_score: number;
    fluency_score: number;
    naturalness_score: number;
    filler_rate: number;
    vocabulary_richness: number;
    slang_count: number;
  }

  export interface SlangEntry {
    id: number;
    term: string;
    first_used_date: string;
    use_count: number;
    example_sentence: string;
  }

  export interface RecurringCorrection {
    what_was_said: string;
    what_to_say: string;
    why: string;
    register: string;
    session_count: number;
    session_ids: string;
  }
