/**
 * VoiceContext — Unified provider-agnostic abstraction over Telnyx + Twilio.
 *
 * All UI components import `useVoice()` from this file.
 * The VoiceContext delegates all calls to whichever provider is currently active.
 *
 * Both TelnyxProvider and TwilioProvider must be mounted as parents.
 * This context reads from them and exposes a single unified interface.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useTelnyxContext } from './TelnyxContext';
import { useTwilioContext } from './TwilioContext';
import type { ConnectionStatus, CallState, QualityMetrics } from './TelnyxContext';

export type VoiceProviderType = 'telnyx' | 'twilio';

export interface VoiceContextValue {
  activeProvider: VoiceProviderType | null;
  
  connectionStatus: ConnectionStatus;
  reconnectStatus: 'disconnected' | 'reconnecting' | 'connected';
  sipConfigured: boolean;
  
  activeCall: any;
  primaryCall: any;
  callState: CallState;
  primaryCallState: CallState;
  duration: number;
  primaryCallDuration: number;
  
  isMuted: boolean;
  isHeld: boolean;
  
  incomingCall: any;
  incomingCallerNumber: string;
  incomingCallerName: string;
  
  heldCall: any;
  heldCallDuration: number;
  heldCallerNumber: string;

  connect: (provider: VoiceProviderType) => Promise<void>;
  disconnect: () => void;
  makeCall: (destination: string, callerNumber?: string) => void;
  dial: (destination: string, callerNumber?: string) => void;
  hangup: () => void;
  mute: () => void;
  unmute: () => void;
  hold: () => void;
  resume: () => void;
  sendDTMF: (digit: string) => void;
  answerIncoming: () => void;
  rejectIncoming: () => void;
  holdAndAnswer: () => void;
  hangupAndResume: () => void;
  
  activeCallRoute: string | null;
  setActiveCallRoute: (route: string | null) => void;

  error: string | null;
  sipError: string | null;
  qualityMetrics: QualityMetrics | null;

  telnyx: ReturnType<typeof useTelnyxContext>;
  twilio: ReturnType<typeof useTwilioContext>;

  toggleMute: () => void;
  toggleHold: () => void;
  connectProvider: (provider: VoiceProviderType) => Promise<void>;
}

const VoiceCtx = createContext<VoiceContextValue | null>(null);

export function VoiceContextProvider({ children }: { children: ReactNode }) {
  const telnyx = useTelnyxContext();
  const twilio = useTwilioContext();
  const [activeProvider, setActiveProvider] = useState<VoiceProviderType | null>(null);

  const active = activeProvider === 'twilio' ? twilio : telnyx;

  const connectProvider = useCallback(async (provider: VoiceProviderType) => {
    console.log(`[VoiceContext] Switching to provider: ${provider}`);

    if (activeProvider && activeProvider !== provider) {
      if (activeProvider === 'telnyx') {
        telnyx.disconnect();
      } else {
        twilio.disconnect();
      }
    }

    setActiveProvider(provider);

    if (provider === 'telnyx') {
      await telnyx.initConnection();
    } else {
      await twilio.initConnection();
    }
  }, [activeProvider, telnyx, twilio]);

  const disconnect = useCallback(() => {
    if (activeProvider === 'telnyx') {
      telnyx.disconnect();
    } else if (activeProvider === 'twilio') {
      twilio.disconnect();
    }
    setActiveProvider(null);
  }, [activeProvider, telnyx, twilio]);

  const makeCall = useCallback((destination: string, callerNumber?: string) => {
    active.dial(destination, callerNumber);
  }, [active]);

  const mute = useCallback(() => {
    active.toggleMute();
  }, [active]);

  const unmute = useCallback(() => {
    active.toggleMute();
  }, [active]);

  const hold = useCallback(() => {
    active.toggleHold();
  }, [active]);

  const resume = useCallback(() => {
    active.toggleHold();
  }, [active]);

  const reconnectStatus = active.connectionStatus === 'registered' 
    ? 'connected' 
    : active.connectionStatus === 'connecting' 
      ? 'reconnecting' 
      : 'disconnected';

  const value: VoiceContextValue = {
    activeProvider,

    connectionStatus: active.connectionStatus,
    reconnectStatus,
    sipConfigured: active.sipConfigured,

    activeCall: active.primaryCall,
    primaryCall: active.primaryCall,
    callState: active.primaryCallState,
    primaryCallState: active.primaryCallState,
    duration: active.primaryCallDuration,
    primaryCallDuration: active.primaryCallDuration,

    isMuted: active.isMuted,
    isHeld: active.isHeld,

    incomingCall: active.incomingCall,
    incomingCallerNumber: active.incomingCallerNumber,
    incomingCallerName: active.incomingCallerName,

    heldCall: active.heldCall,
    heldCallDuration: active.heldCallDuration,
    heldCallerNumber: active.heldCallerNumber,

    connect: connectProvider,
    disconnect,
    makeCall,
    dial: active.dial,
    hangup: active.hangup,
    mute,
    unmute,
    hold,
    resume,
    sendDTMF: active.sendDTMF,
    answerIncoming: active.answerIncoming,
    rejectIncoming: active.rejectIncoming,
    holdAndAnswer: active.holdAndAnswer,
    hangupAndResume: active.hangupAndResume,

    activeCallRoute: active.activeCallRoute,
    setActiveCallRoute: active.setActiveCallRoute,

    error: active.error,
    sipError: active.sipError,
    qualityMetrics: active.qualityMetrics,

    telnyx,
    twilio,

    toggleMute: active.toggleMute,
    toggleHold: active.toggleHold,
    connectProvider,
  };

  return (
    <VoiceCtx.Provider value={value}>
      {children}
    </VoiceCtx.Provider>
  );
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceCtx);
  if (!ctx) {
    throw new Error('useVoice must be used within a VoiceContextProvider');
  }
  return ctx;
}