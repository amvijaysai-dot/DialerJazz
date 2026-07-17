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
  onSelect: (label: string) => void;
  onScheduleDemo?: () => void;
  onScheduleCallback?: () => void;
}

/**
 * DispositionOverlay — bottom-sheet UI that appears after a call ends.
 * Provides quick-tap disposition buttons (Interested, No Answer, DNC, etc.).
 * Demo Booked and Callback open modal forms from the parent page.
 */
export default function DispositionOverlay({
  visible,
  dispositions,
  isDisposing,
  onSelect,
  onScheduleDemo,
  onScheduleCallback,
}: DispositionOverlayProps) {
  const primaryDispositions = dispositions.filter((d) => d.primary);
  const secondaryDispositions = dispositions.filter((d) => !d.primary);

  const handleSelect = (label: string) => {
    if (label === 'Demo Booked' && onScheduleDemo) {
      onScheduleDemo();
    } else if (label === 'Callback' && onScheduleCallback) {
      onScheduleCallback();
    } else {
      onSelect(label);
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          className="absolute inset-x-0 bottom-0 top-[20%] bg-white rounded-t-[28px] border-t border-[#E8EAF0] z-50 shadow-[0_-20px_50px_rgba(17,24,39,0.12)] flex flex-col overflow-hidden"
        >
          {/* Pull handle */}
          <div className="w-16 h-1.5 bg-[#E5E7EB] rounded-full mx-auto mt-4 mb-6" />

          <div className="px-6 flex-1 flex flex-col">
            <h3 className="text-xl font-extrabold text-[#111827] mb-2 text-center">
              What's the outcome?
            </h3>
            <p className="text-[#6B7280] text-sm text-center mb-8">
              Select disposition to save and continue.
            </p>

            <div className="space-y-4">
              {/* Primary Row - Demo Booked, Callback, Not Interested */}
              <div className="grid grid-cols-3 gap-3">
                {primaryDispositions.map((d) => (
                  <button
                    key={d.label}
                    onClick={() => handleSelect(d.label)}
                    disabled={isDisposing}
                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-[#111827] text-white border border-[#111827] hover:bg-black active:scale-95 transition-all disabled:opacity-50"
                  >
                    <span className="text-2xl">{d.emoji}</span>
                    <span className="text-xs font-bold text-center leading-tight">
                      {d.label}
                    </span>
                  </button>
                ))}
              </div>
              <div className="h-px w-full bg-[#E8EAF0] my-2" />
              {/* Secondary Row - No Answer, Voicemail, Wrong Number */}
              <div className="grid grid-cols-3 gap-3 flex-1 pb-6">
                {secondaryDispositions.map((d) => (
                  <button
                    key={d.label}
                    onClick={() => handleSelect(d.label)}
                    disabled={isDisposing}
                    className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] active:scale-95 transition-all text-[#6B7280] hover:text-[#111827]"
                  >
                    <span className="text-xl opacity-70">{d.emoji}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-center">
                      {d.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
