
import React, { useState, useRef } from 'react';
import { Mic, Square, Loader2, CloudUpload } from 'lucide-react';

interface RecorderProps {
  onRecordingComplete: (blob: Blob, duration: number) => void;
  isProcessing: boolean;
}

const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete, isProcessing }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef<number>(0);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        onRecordingComplete(audioBlob, durationRef.current);
        setDuration(0);
        durationRef.current = 0;
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      
      timerRef.current = setInterval(() => {
        setDuration(prev => {
          const newDuration = prev + 1;
          durationRef.current = newDuration;
          return newDuration;
        });
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Please allow microphone access to record.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center p-10 md:p-14 bg-zinc-900/30 border border-zinc-800/40 rounded-[3rem] backdrop-blur-3xl transition-all duration-700 hover:bg-zinc-900/50 shadow-2xl w-full max-w-[320px] md:max-w-sm mx-auto group">
      <div className="mb-10 relative">
        {isRecording && (
          <div className="absolute -inset-8 animate-pulse rounded-full bg-red-500/5 scale-110" />
        )}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          className={`w-20 h-20 md:w-28 md:h-28 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl relative z-10 ${
            isRecording 
              ? 'bg-red-500 hover:bg-red-600 scale-105' 
              : 'bg-indigo-600 hover:bg-indigo-500 hover:scale-105 active:scale-95'
          } ${isProcessing ? 'opacity-20 cursor-not-allowed scale-90' : ''}`}
        >
          {isProcessing ? (
            <Loader2 className="w-8 h-8 md:w-12 md:h-12 text-white animate-spin" />
          ) : isRecording ? (
            <Square className="w-6 h-6 md:w-10 md:h-10 text-white fill-current rounded-lg" />
          ) : (
            <Mic className="w-8 h-8 md:w-12 md:h-12 text-white" />
          )}
        </button>
      </div>

      <div className="text-center">
        <h3 className="text-4xl md:text-5xl font-black text-zinc-100 tabular-nums tracking-tighter mb-3 leading-none">
          {formatTime(duration)}
        </h3>
        <div className="flex flex-col items-center gap-2">
           <p className={`text-[9px] font-black uppercase tracking-[0.4em] transition-colors duration-500 ${isRecording ? 'text-red-500 animate-pulse' : 'text-zinc-600'}`}>
             {isRecording ? "Capturing Stream" : "Standby Mode"}
           </p>
           {isProcessing && (
             <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 rounded-full">
                <CloudUpload size={10} className="text-indigo-400" />
                <span className="text-[8px] font-black uppercase tracking-widest text-indigo-400">Transmitting to Cloud</span>
             </div>
           )}
        </div>
      </div>

      {isRecording && (
        <div className="mt-12 flex gap-1.5 h-6 items-center">
          {[...Array(8)].map((_, i) => (
            <div 
              key={i} 
              className="w-1 bg-red-500/40 rounded-full"
              style={{ 
                height: `${20 + Math.random() * 80}%`,
                animation: `recording-wave 1s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.1}s`
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes recording-wave {
          from { transform: scaleY(0.4); opacity: 0.3; }
          to { transform: scaleY(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default Recorder;
