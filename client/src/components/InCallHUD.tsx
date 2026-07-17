import { motion, AnimatePresence } from 'framer-motion';
import AudioVisualizer from './AudioVisualizer';
import DTMFKeypad from './DTMFKeypad';
import type { CallState } from '@/contexts/TelnyxContext';

interface InCallHUDProps {
  callState: CallState;
  callDuration: number;
  remoteStream: MediaStream | null;
  showDTMF: boolean;
  onSendDTMF: (key: string) => void;
}

const CALL_STATE_LABELS: Record<string, string> = {
  trying: 'Dialing...',
  ringing: 'Ringing...',
  active: 'In Call',
};

/**
 * InCallHUD — overlay shown inside the lead card during an active call.
 * Displays call timer, audio visualizer, and optional DTMF keypad.
 */
export default function InCallHUD({
  callState,
  callDuration,
  remoteStream,
  showDTMF,
  onSendDTMF,
}: InCallHUDProps) {
  const isInCall = ['trying', 'ringing', 'active'].includes(callState);
  const minutes = Math.floor(callDuration / 60).toString().padStart(2, '0');
  const seconds = (callDuration % 60).toString().padStart(2, '0');

  return (
    <AnimatePresence>
      {isInCall && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="absolute inset-x-0 bottom-0 top-0 z-20 flex flex-col items-center justify-center p-8 text-center bg-white/80 backdrop-blur-xl rounded-[20px] border border-[#E8EAF0] shadow-[0_8px_30px_rgba(17,24,39,0.08)]"
        >
          <div className="h-3 w-3 rounded-full bg-[#22C55E] animate-pulse mb-4 shadow-[0_0_12px_rgba(34,197,94,0.6)]" />
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1">
            {CALL_STATE_LABELS[callState] || callState}
          </span>
          <span className="text-6xl font-extrabold text-[#111827] tabular-nums tracking-tighter mb-6">
            {minutes}:{seconds}
          </span>

          {/* Audio Visualizer */}
          <div className="w-full max-w-md h-16 bg-[#F7F8FA] rounded-xl border border-[#E8EAF0] mb-6 flex justify-center items-center overflow-hidden">
            {callState === 'active' && remoteStream ? (
              <AudioVisualizer mediaStream={remoteStream} color="#F97316" />
            ) : (
              <div className="h-px w-full bg-[#E5E7EB]" />
            )}
          </div>

          {/* DTMF Keypad */}
          <DTMFKeypad visible={showDTMF} onPress={onSendDTMF} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
