
import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, CheckCircle2, ListTodo, FileText, Share2, Info, X, CloudCheck, CloudUpload, RefreshCw, Menu, Wand2, Trash, MicOff, Edit2, Check } from 'lucide-react';
import { Recording } from './types';
import { apiService } from './services/apiService';
import Recorder from './components/Recorder';
import RecordingCard from './components/RecordingCard';
import { supabaseService } from './services/SupabaseService';

interface TitleEditorProps {
  title: string;
  onSave: (newTitle: string) => void;
  isProcessing?: boolean;
}

const TitleEditor: React.FC<TitleEditorProps> = ({ title, onSave, isProcessing }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditedTitle(title);
  }, [title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedTitle = editedTitle.trim();
    if (trimmedTitle && trimmedTitle !== title) {
      onSave(trimmedTitle);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedTitle(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="flex-1 min-w-0 bg-zinc-900 border border-indigo-500/50 rounded-xl px-4 py-2 text-3xl md:text-4xl font-black tracking-tighter text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
        <button
          onClick={handleSave}
          className="p-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-xl transition-all"
          title="Save"
        >
          <Check size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 group flex-1 min-w-0">
      <h2 className="text-3xl md:text-4xl font-black tracking-tighter truncate leading-none">{title}</h2>
      {!isProcessing && (
        <button
          onClick={() => setIsEditing(true)}
          className="opacity-0 group-hover:opacity-100 p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all shrink-0"
          title="Edit name"
        >
          <Edit2 size={18} />
        </button>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isProcessingGlobal, setIsProcessingGlobal] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved'>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingRecording, setPendingRecording] = useState<{ blob: Blob; duration: number } | null>(null);
  const [pendingRecordingName, setPendingRecordingName] = useState('');
  const [showNoVoicesFound, setShowNoVoicesFound] = useState(false);

  // Initial Data Fetch from Backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiService.getRecordings();
        setRecordings(data);
      } catch (err) {
        console.error("Backend fetch failed", err);
      } finally {
        setIsInitialLoading(false);
      }
    };
    fetchData();
  }, []);

  // Handle window resizing
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setIsSidebarOpen(true);
      else setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeRecording = recordings.find(r => r.id === activeId);

  // Auto-redirect to home if active recording is deleted
  useEffect(() => {
    if (activeId && !activeRecording) {
      setActiveId(null);
      setPendingRecording(null);
      setPendingRecordingName('');
    }
  }, [activeId, activeRecording]);

  useEffect(() => {
    supabaseService.initialize();
  }, []);

  const handleRecordingComplete = (blob: Blob, duration: number) => {
    setPendingRecording({ blob, duration });
    setPendingRecordingName(`Recording ${recordings.length + 1}`);
  };

  const startProcessing = async () => {
    if (!pendingRecording) return;

    const { blob, duration } = pendingRecording;
    const recordingTitle = pendingRecordingName.trim() || `Recording ${recordings.length + 1}`;
    setPendingRecording(null);
    setPendingRecordingName('');
    setSyncStatus('syncing');
    
    const id = Date.now().toString();
    const newRecording: Recording = {
      id,
      title: recordingTitle,
      timestamp: Date.now(),
      duration,
      status: 'processing',
      notes: [],
      actionItems: []
    };

    // Update Local State Optimistically
    setRecordings(prev => [newRecording, ...prev]);
    setIsProcessingGlobal(true);
    setActiveId(id); // Automatically navigate to the new item

    
    try {
      // Save recording with blob (will be stored in Mega.nz if backend unavailable)
      await apiService.saveRecording(newRecording, blob);

      try {
        const result = await apiService.processAudio(blob.type, id, blob);
        
        const updated: Recording = { 
          ...newRecording, 
          status: 'completed',
          transcript: result.summary,
          notes: result.notes,
          actionItems: result.actionItems
        };

        setRecordings(prev => prev.map(r => r.id === id ? updated : r));
        // Save updated recording (blob already saved, so don't pass it again)
        await apiService.saveRecording(updated);
        
        setSyncStatus('saved');
        setTimeout(() => setSyncStatus('idle'), 3000);
      } catch (err) {
        // If audio was empty and recording was deleted, show "no voices found" screen
        if (err instanceof Error && err.message === 'EMPTY_AUDIO') {
          // Remove from state
          setRecordings(prev => prev.filter(r => r.id !== id));
          // Show "no voices found" screen
          setShowNoVoicesFound(true);
          setActiveId(null);
          setPendingRecording(null);
          console.log('Recording deleted due to empty audio - showing no voices found screen');
          
          // Redirect to home after 3 seconds
          setTimeout(() => {
            setShowNoVoicesFound(false);
          }, 3000);
        } else {
          const errorState: Recording = { ...newRecording, status: 'error' };
          setRecordings(prev => prev.map(r => r.id === id ? errorState : r));
          await apiService.saveRecording(errorState);
        }
        setSyncStatus('idle');
      } finally {
        setIsProcessingGlobal(false);
      }
    } catch (err) {
      console.error("Backend synchronization failed", err);
      // If it's an empty audio error from the outer catch, handle it here too
      if (err instanceof Error && err.message === 'EMPTY_AUDIO') {
        setRecordings(prev => prev.filter(r => r.id !== id));
        setShowNoVoicesFound(true);
        setActiveId(null);
        setPendingRecording(null);
        console.log('Recording deleted due to empty audio - showing no voices found screen');
        
        // Redirect to home after 3 seconds
        setTimeout(() => {
          setShowNoVoicesFound(false);
        }, 3000);
      }
      // For other errors in saveRecording, just log and continue
      setIsProcessingGlobal(false);
      setSyncStatus('idle');
    }
  };

  const deleteRecording = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Permanently delete this cloud recording?')) {
      setSyncStatus('syncing');
      try {
        await apiService.deleteRecording(id);
        setRecordings(prev => prev.filter(r => r.id !== id));
        if (activeId === id) setActiveId(null);
        setSyncStatus('saved');
        setTimeout(() => setSyncStatus('idle'), 2000);
      } catch (err) {
        console.error("Failed to delete from backend", err);
        setSyncStatus('idle');
      }
    }
  };

  const updateRecordingTitle = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    
    setSyncStatus('syncing');
    try {
      const recording = recordings.find(r => r.id === id);
      if (!recording) return;

      const updated: Recording = { ...recording, title: newTitle.trim() };
      setRecordings(prev => prev.map(r => r.id === id ? updated : r));
      await apiService.saveRecording(updated);
      setSyncStatus('saved');
      setTimeout(() => setSyncStatus('idle'), 2000);
    } catch (err) {
      console.error("Failed to update recording title", err);
      setSyncStatus('idle');
    }
  };

  const filteredRecordings = recordings.filter(r => 
    r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.transcript?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const closeSidebar = () => {
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden relative font-['Inter'] selection:bg-indigo-500/30">
      
      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-300" onClick={closeSidebar} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-80 bg-zinc-950 border-r border-zinc-900 z-50 transform transition-transform duration-500 cubic-bezier(0.4, 0, 0.2, 1)
        lg:relative lg:translate-x-0 
        ${isSidebarOpen ? 'translate-x-0 shadow-[20px_0_60px_-15px_rgba(0,0,0,0.7)]' : '-translate-x-full lg:-ml-80'}
      `}>
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2 cursor-pointer group" onClick={() => { setActiveId(null); closeSidebar(); setPendingRecording(null); }}>
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/40 group-hover:scale-110 transition-transform">
                <div className="w-1 h-4 bg-white rounded-full mx-0.5" />
                <div className="w-1 h-6 bg-white rounded-full mx-0.5" />
                <div className="w-1 h-4 bg-white rounded-full mx-0.5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">EchoNote</h1>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-900 rounded-lg transition-all">
              <X size={18} />
            </button>
          </div>

          <div className="relative mb-6">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input 
              type="text" 
              placeholder="Query recordings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/40 border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-600"
            />
          </div>

          <div className="flex items-center justify-between mb-4 px-1">
            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.4em]">Archive</span>
            {isInitialLoading && <RefreshCw size={10} className="text-indigo-500 animate-spin" />}
          </div>

          <div className="flex-1 overflow-y-auto px-1 space-y-1.5 custom-scrollbar">
            {isInitialLoading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-zinc-900/30 rounded-xl animate-pulse" />
              ))
            ) : filteredRecordings.length === 0 ? (
              <div className="text-center py-20 px-4">
                <p className="text-zinc-700 text-[10px] font-bold uppercase tracking-widest">No matching records</p>
              </div>
            ) : (
              filteredRecordings.map(r => (
                <div key={r.id} className="relative group">
                  <RecordingCard 
                    recording={r} 
                    isActive={activeId === r.id} 
                    onClick={() => { setActiveId(r.id); closeSidebar(); setPendingRecording(null); setPendingRecordingName(''); }}
                    onTitleUpdate={updateRecordingTitle}
                  />
                  <button 
                    onClick={(e) => deleteRecording(r.id, e)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 text-zinc-600 hover:text-red-400 transition-all hover:bg-red-500/5 rounded-lg"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="pt-6 border-t border-zinc-900/50 mt-4 px-2">
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600">
               {syncStatus === 'syncing' ? (
                 <><RefreshCw size={12} className="animate-spin text-indigo-500" /> Syncing...</>
               ) : syncStatus === 'saved' ? (
                 <><CloudCheck size={12} className="text-emerald-500" /> Saved</>
               ) : (
                 <><CloudUpload size={12} className="opacity-50" /> Cloud Backup Active</>
               )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col bg-zinc-950 relative overflow-hidden w-full">
        
        {/* Modern Header */}
        <header className="flex items-center justify-between px-6 py-4 md:py-6 border-b border-zinc-900/50 bg-zinc-950/40 backdrop-blur-xl z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)} 
              className={`p-2.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-xl transition-all border border-transparent hover:border-zinc-800 ${isSidebarOpen && window.innerWidth >= 1024 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              <Menu size={20} />
            </button>
          </div>

          <div>
            {(activeId || pendingRecording) && (
              <button 
                onClick={() => { setActiveId(null); setPendingRecording(null); setPendingRecordingName(''); }} 
                className="flex items-center gap-2 px-4 py-2 text-zinc-400 hover:text-zinc-100 text-[10px] font-black uppercase tracking-widest transition-all hover:bg-zinc-900 rounded-xl"
              >
                <Plus size={14} /> New Capture
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Views */}
        {showNoVoicesFound ? (
          /* NO VOICES FOUND VIEW */
          <div className="flex-1 flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-700">
            <div className="w-full max-w-sm p-10 bg-zinc-900/30 border border-zinc-800/40 rounded-[3rem] backdrop-blur-3xl text-center">
              <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-amber-500/20">
                <MicOff size={32} className="text-amber-400" />
              </div>
              <h3 className="text-2xl font-black tracking-tight mb-2">No Voices Found</h3>
              <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-10">
                The audio recording contains no speech or is empty.
              </p>
              <p className="text-zinc-600 text-[9px] font-medium mb-6">
                Redirecting to home...
              </p>
            </div>
          </div>
        ) : !activeId && !pendingRecording ? (
          /* RECORDER VIEW */
          <div className="flex-1 flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-700">
            <div className="w-full max-w-sm">
              <Recorder onRecordingComplete={handleRecordingComplete} isProcessing={isProcessingGlobal} />
              <div className="mt-14 text-center">
                <p className="text-zinc-700 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
                  Ready to Capture
                </p>
                <p className="text-zinc-800 text-[9px] font-medium max-w-[200px] mx-auto italic">
                  Capture your thoughts and let Gemini handle the structure.
                </p>
              </div>
            </div>
          </div>
        ) : pendingRecording ? (
          /* POST-RECORDING PREVIEW */
          <div className="flex-1 flex flex-col items-center justify-center p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-full max-w-sm p-10 bg-zinc-900/30 border border-zinc-800/40 rounded-[3rem] backdrop-blur-3xl text-center">
               <div className="w-20 h-20 bg-indigo-600/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-indigo-500/20">
                  <CloudUpload size={32} className="text-indigo-400" />
               </div>
               <h3 className="text-2xl font-black tracking-tight mb-4">Capture Ready</h3>
               
               {/* Recording Name Input */}
               <div className="mb-6">
                 <label className="block text-zinc-500 text-[9px] font-black uppercase tracking-widest mb-2 text-left">
                   Recording Name
                 </label>
                 <input
                   type="text"
                   value={pendingRecordingName}
                   onChange={(e) => setPendingRecordingName(e.target.value)}
                   placeholder="Enter recording name..."
                   className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                   autoFocus
                 />
               </div>
               
               <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-10">
                 Duration: {Math.floor(pendingRecording.duration / 60)}:{(pendingRecording.duration % 60).toString().padStart(2, '0')}
               </p>
               
               <div className="flex flex-col gap-3">
                  <button 
                    onClick={startProcessing}
                    className="flex items-center justify-center gap-3 w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-600/20"
                  >
                    <Wand2 size={16} /> Analyze Audio
                  </button>
                  <button 
                    onClick={() => { setPendingRecording(null); setPendingRecordingName(''); }}
                    className="flex items-center justify-center gap-3 w-full py-4 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border border-zinc-800"
                  >
                    <Trash size={16} /> Discard Capture
                  </button>
               </div>
            </div>
          </div>
        ) : (
          /* ANALYSIS VIEW */
          <div className="flex-1 flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-8 duration-700">
            {/* Analysis Header */}
            <div className="px-6 md:px-12 pt-10 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <TitleEditor 
                    title={activeRecording?.title || ''} 
                    onSave={(newTitle) => activeRecording && updateRecordingTitle(activeRecording.id, newTitle)}
                    isProcessing={activeRecording?.status === 'processing'}
                  />
                  {activeRecording?.status === 'processing' && (
                    <span className="px-3 py-1 bg-indigo-500/10 text-indigo-400 text-[8px] font-black rounded-full animate-pulse uppercase tracking-[0.2em] border border-indigo-500/20">
                      Analyzing
                    </span>
                  )}
                </div>
                <p className="text-zinc-600 text-[11px] font-black uppercase tracking-[0.3em]">
                  {activeRecording ? new Date(activeRecording.timestamp).toLocaleDateString(undefined, {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                  }) : ''}
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                 <button className="flex items-center gap-3 px-6 py-3.5 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
                  <Share2 size={14} /> Export Insight
                </button>
                <button 
                  onClick={() => setActiveId(null)}
                  className="p-3.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/5 rounded-2xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 md:px-12 pb-24 custom-scrollbar">
              <div className="max-w-5xl mx-auto space-y-20 pt-10">
                {!activeRecording ? (
                  // Recording was deleted or not found - redirect handled by parent
                  <div className="py-24 flex flex-col items-center justify-center text-center">
                    <div className="relative mb-10">
                       <RefreshCw size={24} className="text-indigo-600 animate-spin" />
                    </div>
                    <h3 className="text-xl font-black tracking-tight text-zinc-200">Redirecting...</h3>
                  </div>
                ) : activeRecording.status === 'processing' ? (
                  <div className="py-24 flex flex-col items-center justify-center text-center">
                    <div className="relative mb-10">
                       <div className="w-16 h-16 border border-zinc-900 rounded-full flex items-center justify-center">
                          <RefreshCw size={24} className="text-indigo-600 animate-spin" />
                       </div>
                       <div className="absolute -inset-4 border border-indigo-500/20 rounded-full animate-ping opacity-20" />
                    </div>
                    <h3 className="text-xl font-black tracking-tight text-zinc-200">Processing Audio Stream</h3>
                    <p className="text-zinc-600 text-[11px] font-bold uppercase tracking-[0.2em] mt-3">AI Synthesis in progress...</p>
                  </div>
                ) : activeRecording.status === 'completed' ? (
                  <>
                    <section className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="w-1 h-5 bg-indigo-500 rounded-full" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">The Context</h3>
                      </div>
                      <div className="text-zinc-200 text-xl md:text-3xl leading-snug font-light max-w-4xl">
                        {activeRecording.transcript}
                      </div>
                    </section>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
                      <section className="animate-in fade-in slide-in-from-bottom-12 duration-700 delay-300">
                        <div className="flex items-center gap-3 mb-8">
                          <FileText size={14} className="text-amber-500/60" />
                          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">Analytical Notes</h3>
                        </div>
                        <ul className="space-y-6">
                          {activeRecording.notes.map((note, i) => (
                            <li key={i} className="flex gap-5 group">
                              <span className="mt-2.5 w-1 h-1 rounded-full bg-zinc-800 shrink-0 group-hover:bg-indigo-500 transition-colors" />
                              <p className="text-zinc-400 text-sm md:text-base leading-relaxed group-hover:text-zinc-200 transition-colors">{note}</p>
                            </li>
                          ))}
                        </ul>
                      </section>

                      <section className="animate-in fade-in slide-in-from-bottom-12 duration-700 delay-500">
                        <div className="flex items-center gap-3 mb-8">
                          <ListTodo size={14} className="text-emerald-500/60" />
                          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">Critical Actions</h3>
                        </div>
                        <ul className="space-y-4">
                          {activeRecording.actionItems.map((item, i) => (
                            <li key={i} className="flex gap-4 p-5 bg-zinc-900/10 border border-zinc-900/40 rounded-3xl group hover:bg-zinc-900/30 hover:border-zinc-800 transition-all">
                              <CheckCircle2 size={16} className="text-zinc-800 mt-1 group-hover:text-emerald-500 transition-colors shrink-0" />
                              <p className="text-zinc-300 text-sm font-bold leading-tight">{item}</p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>
                  </>
                ) : (
                  <div className="py-24 flex flex-col items-center text-center">
                    <div className="p-6 bg-red-500/5 rounded-[2rem] border border-red-500/10 mb-8">
                      <Info size={32} className="text-red-500/40" />
                    </div>
                    <h3 className="text-xl font-black tracking-tight">Backend Failure</h3>
                    <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-[0.2em] mt-3">Unable to reconcile audio stream with neural cloud</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f1f23; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #2d2d33; }
      `}</style>
    </div>
  );
};

export default App;
