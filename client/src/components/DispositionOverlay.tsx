import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DispositionOption {
  value: string;
  label: string;
  color: string;
  emoji: string;
  primary?: boolean;
}

interface DispositionOverlayProps {
  visible: boolean;
  dispositions: DispositionOption[];
  isDisposing: boolean;
  onSelect: (label: string, callbackDetails?: { date: string; time: string; notes: string }) => void;
}

/**
 * DispositionOverlay — bottom-sheet UI that appears after a call ends.
 * Provides quick-tap disposition buttons (Interested, No Answer, DNC, etc.).
 * Selecting "Callback" reveals a Date/Time/Notes sub-form that auto-saves.
 */
export default function DispositionOverlay({
  visible,
  dispositions,
  isDisposing,
  onSelect,
}: DispositionOverlayProps) {
  const primaryDispositions = dispositions.filter((d) => d.primary);
  const secondaryDispositions = dispositions.filter((d) => !d.primary);

  const [showCallbackForm, setShowCallbackForm] = useState(false);
  const [cbDate, setCbDate] = useState('');
  const [cbTime, setCbTime] = useState('');
  const [cbNotes, setCbNotes] = useState('');

  const handleSelect = (label: string) => {
    if (label === 'Callback') {
      setShowCallbackForm(true);
      return;
    }
    // Reset the callback form for the next time the overlay opens
    setShowCallbackForm(false);
    setCbDate('');
    setCbTime('');
    setCbNotes('');
    onSelect(label);
  };

  const saveCallback = () => {
    onSelect('Callback', { date: cbDate, time: cbTime, notes: cbNotes });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          className="absolute inset-x-0 bottom-0 top-[30%] bg-surface backdrop-blur-md rounded-t-[2.5rem] border-t-2 border-border z-50 shadow-[0_-20px_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden"
        >
          {/* Pull handle */}
          <div className="w-16 h-1.5 bg-white/20 rounded-full mx-auto mt-4 mb-6" />

          <div className="px-6 flex-1 flex flex-col">
            {!showCallbackForm ? (
              <>
                <h3 className="text-xl font-extrabold text-foreground mb-2 text-center">
                  What's the outcome?
                </h3>
                <p className="text-muted-foreground text-sm text-center mb-8">
                  Select disposition to save and continue.
                </p>

                <div className="space-y-4">
                  {/* Primary Row */}
                  <div className="grid grid-cols-3 gap-3">
                    {primaryDispositions.map((d) => (
                      <button
                        key={d.label}
                        onClick={() => handleSelect(d.label)}
                        disabled={isDisposing}
                        className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-muted border border-border hover:bg-muted hover:bg-muted/80 active:scale-95 transition-all disabled:opacity-50"
                      >
                        <span className="text-2xl">{d.emoji}</span>
                        <span className="text-xs font-bold text-foreground text-center leading-tight">
                          {d.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="h-px w-full bg-muted my-2" />
                  {/* Secondary Row */}
                  <div className="grid grid-cols-3 gap-3 flex-1 pb-6">
                    {secondaryDispositions.map((d) => (
                      <button
                        key={d.label}
                        onClick={() => handleSelect(d.label)}
                        disabled={isDisposing}
                        className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl bg-transparent border border-border hover:bg-muted active:scale-95 transition-all text-muted-foreground hover:text-foreground"
                      >
                        <span className="text-xl opacity-70">{d.emoji}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-center">
                          {d.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-extrabold text-foreground mb-2 text-center">
                  Schedule a Callback
                </h3>
                <p className="text-muted-foreground text-sm text-center mb-6">
                  Pick a date & time, add notes, then save.
                </p>

                <div className="flex flex-col gap-4 pb-6">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Date</span>
                      <input
                        type="date"
                        value={cbDate}
                        onChange={(e) => setCbDate(e.target.value)}
                        className="bg-muted border border-border rounded-xl px-3 py-2 text-foreground"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Time</span>
                      <input
                        type="time"
                        value={cbTime}
                        onChange={(e) => setCbTime(e.target.value)}
                        className="bg-muted border border-border rounded-xl px-3 py-2 text-foreground"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Notes</span>
                    <textarea
                      value={cbNotes}
                      onChange={(e) => setCbNotes(e.target.value)}
                      placeholder="Reason for callback, context, etc."
                      className="bg-muted border border-border rounded-xl px-3 py-2 text-foreground min-h-[80px] resize-none"
                    />
                  </label>

                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => setShowCallbackForm(false)}
                      className="flex-1 py-3 rounded-2xl bg-muted border border-border text-foreground font-semibold active:scale-95 transition-all"
                    >
                      Back
                    </button>
                    <button
                      onClick={saveCallback}
                      disabled={isDisposing}
                      className="flex-[2] py-3 rounded-2xl bg-foreground text-background font-bold active:scale-95 transition-all disabled:opacity-50"
                    >
                      Save Callback
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
