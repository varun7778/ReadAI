
import React, { useState, useRef, useEffect } from 'react';
import { Clock, ChevronRight, FileAudio, Circle, Edit2, Check, X } from 'lucide-react';
import { Recording } from '../types';

interface RecordingCardProps {
  recording: Recording;
  isActive: boolean;
  onClick: () => void;
  onTitleUpdate?: (id: string, newTitle: string) => void;
}

const RecordingCard: React.FC<RecordingCardProps> = ({ recording, isActive, onClick, onTitleUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(recording.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditedTitle(recording.title);
  }, [recording.title]);

  const time = new Date(recording.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });

  const durationStr = `${Math.floor(recording.duration / 60)}:${(recording.duration % 60).toString().padStart(2, '0')}`;

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const trimmedTitle = editedTitle.trim();
    if (trimmedTitle && trimmedTitle !== recording.title && onTitleUpdate) {
      onTitleUpdate(recording.id, trimmedTitle);
    }
    setIsEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditedTitle(recording.title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      handleSave(e as any);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      handleCancel(e as any);
    }
  };

  return (
    <div 
      onClick={onClick}
      className={`group cursor-pointer p-3.5 rounded-xl transition-all duration-300 border ${
        isActive 
          ? 'bg-zinc-800 border-zinc-700 shadow-xl' 
          : 'bg-transparent border-transparent hover:bg-zinc-900/60'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg transition-colors ${
          isActive 
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' 
            : 'bg-zinc-900 text-zinc-500 group-hover:text-zinc-300'
        }`}>
          <FileAudio size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {isEditing ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-zinc-800 border border-indigo-500/50 rounded-lg px-2 py-0.5 text-sm font-bold text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={handleSave}
                  className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-all"
                  title="Save"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={handleCancel}
                  className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-all"
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <h4 className={`text-sm font-bold truncate transition-colors ${isActive ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                  {recording.title}
                </h4>
                {recording.status === 'processing' && (
                  <Circle size={6} className="fill-indigo-500 text-indigo-500 animate-pulse shrink-0" />
                )}
                <button
                  onClick={handleEdit}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded transition-all ml-1 shrink-0"
                  title="Edit name"
                >
                  <Edit2 size={11} />
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-zinc-600 font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Clock size={10} /> {time}
            </span>
            <span>{durationStr}</span>
          </div>
        </div>
        <ChevronRight size={14} className={`transition-all ${isActive ? 'translate-x-0.5 text-indigo-400' : 'opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 text-zinc-700'}`} />
      </div>
    </div>
  );
};

export default RecordingCard;
