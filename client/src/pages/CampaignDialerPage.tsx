import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import {
  Phone,
  PhoneOff,
  Hash,
  Loader2,
  AlertCircle,
  ArrowLeft,
  MapPin,
  Mail,
  Zap,
  MousePointerClick,
  Smartphone,
  Globe,
  Star,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  StickyNote,
  CalendarDays,
  Clock,
  ThumbsDown,
  XCircle,
  Voicemail,
} from 'lucide-react';
import { toast } from 'sonner';
import { callsApi, leadsApi, campaignsApi } from '@/lib/api';
import type { Lead, Campaign } from '@/lib/api';
import { useVoice } from '@/contexts/VoiceContext';
import type { CallState } from '@/contexts/TelnyxContext';
import { useLocalCalling } from '@/hooks/useLocalCalling';
import InCallHUD from '@/components/InCallHUD';
import DispositionOverlay from '@/components/DispositionOverlay';
import ScheduleDemoModal from '@/components/ScheduleDemoModal';
import ScheduleCallbackModal from '@/components/ScheduleCallbackModal';

type DialerMode = 'power' | 'click';
type Disposition = 'demo_booked' | 'callback' | 'not_interested' | 'no_answer' | 'voicemail' | 'wrong_number';

const DISPOSITIONS: { value: Disposition; label: string; color: string; emoji: string; primary?: boolean }[] = [
  { value: 'demo_booked', label: 'Demo Booked', color: 'bg-green-500 text-white', emoji: '📅', primary: true },
  { value: 'callback', label: 'Callback', color: 'bg-orange-500 text-white', emoji: '⏰', primary: true },
  { value: 'not_interested',label: 'Not Interested', color: 'bg-gray-500 text-white', emoji: '❄️', primary: true },
  { value: 'no_answer',      label: 'No Answer',      color: 'bg-yellow-500 text-[#111827]', emoji: '📵' },
  { value: 'voicemail',      label: 'Voicemail',       color: 'bg-blue-500 text-white', emoji: '📩' },
  { value: 'wrong_number',   label: 'Wrong Number',    color: 'bg-red-500 text-white', emoji: '❌' },
];

// Quick-tap call outcomes shown in the operator workspace (left panel).
const CALL_OUTCOMES: { label: string; emoji: string; color: string; icon: React.ReactNode }[] = [
  { label: 'Demo Booked',   emoji: '📅', color: 'bg-green-500', icon: <CalendarDays className="h-5 w-5" /> },
  { label: 'Callback',      emoji: '⏰', color: 'bg-orange-500', icon: <Clock className="h-5 w-5" /> },
  { label: 'Not Interested', emoji: '❄️', color: 'bg-gray-500', icon: <ThumbsDown className="h-5 w-5" /> },
  { label: 'Voicemail',     emoji: '📩', color: 'bg-blue-500', icon: <Voicemail className="h-5 w-5" /> },
  { label: 'No Answer',     emoji: '📵', color: 'bg-yellow-500', icon: <PhoneOff className="h-5 w-5" /> },
  { label: 'Wrong Number',  emoji: '❌', color: 'bg-red-500', icon: <XCircle className="h-5 w-5" /> },
];

const INTER_FONT = 'Inter, "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';

// Dynamic AI talking points derived from the current lead.
function getTalkingPoints(lead: Lead): string[] {
  const pts: string[] = [];
  if (lead.company) pts.push(`Mention ${lead.company} by name`);
  pts.push('Mention 24/7 service availability');
  pts.push('Mention our free estimate');
  pts.push('Ask who currently handles their inbound calls');
  pts.push('Reference the calls they might be missing');
  if (lead.business_category) pts.push(`Reference their work in ${lead.business_category}`);
  return pts.slice(0, 5);
}

export default function CampaignDialerPage() {
  const { id: campaignId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [totalLeadsCount, setTotalLeadsCount] = useState(0);
  const [calledLeadsCount, setCalledLeadsCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dialerSessionMode = (campaign?.dialer_mode as DialerMode) || 'click';
  const [showDisposition, setShowDisposition] = useState(false);
  const [isDisposing, setIsDisposing] = useState(false);
  const [showDTMF, setShowDTMF] = useState(false);
  const [notes, setNotes] = useState('');
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showCallbackModal, setShowCallbackModal] = useState(false);

  // ── Power Dialer state ───────────────────────────────────────────────
  const [isPowerRunning, setIsPowerRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [powerDelay, setPowerDelay] = useState(3); // seconds between calls
  const powerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Campaign complete stats
  const [showCampaignComplete, setShowCampaignComplete] = useState(false);
  const [campaignStats, setCampaignStats] = useState({
    completed: 0,
    demoBooked: 0,
    callbacks: 0,
    voicemails: 0,
    noAnswers: 0,
    wrongNumbers: 0,
    notInterested: 0,
  });

  // Voice (from unified context — delegates to Telnyx or Twilio)
  const voice = useVoice();
  const prevCallState = useRef<CallState>('idle');

  // Local SIM calling — triggers disposition when user returns from native dialer
  const handleLocalCallReturn = useCallback(() => {
    setShowDisposition(true);
  }, []);
  const { call: localCall } = useLocalCalling(handleLocalCallReturn);

  // Load backend data
  const loadData = useCallback(async () => {
    if (!campaignId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [campaignRes, leadsRes] = await Promise.all([
        campaignsApi.get(campaignId),
        leadsApi.listByCampaign(campaignId, { limit: 500 }),
      ]);
      setCampaign(campaignRes.data as Campaign);

      const allLeads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
      // Load ALL leads (including already-dialed) so user can navigate freely
      setLeads(allLeads);

      // Track total and called counts for display
      const dialedCount = allLeads.filter(l => l.status !== 'new' && l.status !== 'calling').length;
      setTotalLeadsCount(allLeads.length);
      setCalledLeadsCount(dialedCount);

      // Restore position by lead ID (survives array size changes)
      const savedLeadId = localStorage.getItem(`dialer_lead_${campaignId}`);
      if (savedLeadId) {
        const idx = allLeads.findIndex(l => l.id === savedLeadId);
        setCurrentIndex(idx >= 0 ? idx : 0);
      } else {
        setCurrentIndex(0);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load campaign';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Track this route for the ActiveCallBubble (so it knows where to return).
  // Deliberately NOT clearing on unmount — the route must persist after
  // navigation so the bubble can show it. It gets cleared when the call ends.
  const isOnCall = ['trying', 'ringing', 'active'].includes(voice.primaryCallState);
  useEffect(() => {
    if (campaignId && !isOnCall) {
      voice.setActiveCallRoute(`/campaigns/${campaignId}/dial`);
    }
  }, [campaignId]);

  // Auto-connect to campaign's provider when campaign loads
  useEffect(() => {
    if (campaign?.provider && campaign.provider !== 'local' && voice.activeProvider !== campaign.provider) {
      voice.connect(campaign.provider);
    }
  }, [campaign?.provider]);

  // Handle call lifecycle — show disposition after ANY call attempt ends
  useEffect(() => {
    const wasCallAttempt = ['trying', 'ringing', 'active'].includes(prevCallState.current);
    if (wasCallAttempt && voice.primaryCallState === 'done') {
      // Call ended (whether connected or not) -> Show disposition overlay
      setShowDisposition(true);
      setShowDTMF(false);
    }
    prevCallState.current = voice.primaryCallState;
  }, [voice.primaryCallState]);

  useEffect(() => {
    if (voice.sipError) toast.error(voice.sipError, { duration: 5000 });
  }, [voice.sipError]);

  const currentLead = leads[currentIndex];
  // Maintain context
  useEffect(() => {
    if (currentLead) setNotes(currentLead.notes || '');
  }, [currentLead]);

  const handleDial = () => {
    if (!currentLead) return;

    // Local SIM: use tel: URI, skip WebRTC entirely
    if (campaign?.provider === 'local') {
      localCall(currentLead.phone);
      return;
    }

    if (!voice.sipConfigured) return toast.error('Configure a telephony provider in Connectors first.');
    if (voice.connectionStatus !== 'registered') return toast.error('Connecting...');
    voice.makeCall(currentLead.phone, campaign?.caller_number);
  };

  const handleHangUp = () => {
    voice.hangup();
  };

  const navigateNext = () => {
    if (currentIndex + 1 < leads.length) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      // Save the lead ID we're navigating TO (survives array changes on refresh)
      if (campaignId && leads[newIndex]) {
        localStorage.setItem(`dialer_lead_${campaignId}`, leads[newIndex].id);
      }
    }
    else toast.info('All leads dialed!');
  }

  const navigatePrev = () => {
    if (currentIndex - 1 >= 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      if (campaignId && leads[newIndex]) {
        localStorage.setItem(`dialer_lead_${campaignId}`, leads[newIndex].id);
      }
    }
  }

  // ── Power Dialer: schedule the next call after a delay ────────────────
  const dialNextLeadAfterDelay = useCallback(() => {
    if (powerTimerRef.current) clearTimeout(powerTimerRef.current);
    if (!isPowerRunning || isPaused) return;
    // Stop if we're on the last lead
    if (currentIndex + 1 >= leads.length) {
      setIsPowerRunning(false);
      // Calculate final stats
      const stats = {
        completed: totalLeadsCount,
        demoBooked: leads.filter(l => l.status === 'demo_booked').length + 1,
        callbacks: leads.filter(l => l.status === 'callback').length + 1,
        voicemails: leads.filter(l => l.status === 'voicemail').length,
        noAnswers: leads.filter(l => l.status === 'no_answer').length,
        wrongNumbers: leads.filter(l => l.status === 'wrong_number').length,
        notInterested: leads.filter(l => l.status === 'not_interested').length,
      };
      setCampaignStats(stats);
      setShowCampaignComplete(true);
      return;
    }
    powerTimerRef.current = setTimeout(() => {
      if (!isPaused && isPowerRunning) {
        // Auto-dial the current lead (already navigated to in disposition handler)
        setTimeout(() => {
          if (isPowerRunning && !isPaused && !['trying', 'ringing', 'active'].includes(voice.primaryCallState)) {
            handleDial();
          }
        }, 300);
      }
    }, powerDelay * 1000);
  }, [isPowerRunning, isPaused, currentIndex, leads.length, leads, powerDelay, voice.primaryCallState, handleDial, totalLeadsCount]);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (powerTimerRef.current) clearTimeout(powerTimerRef.current);
    };
  }, []);

  const startPowerDialer = () => {
    setIsPowerRunning(true);
    setIsPaused(false);
    toast.success('Power Dialer started');
    // Dial the current lead immediately
    if (!['trying', 'ringing', 'active'].includes(voice.primaryCallState)) {
      handleDial();
    }
  };

  const pausePowerDialer = () => {
    setIsPaused(true);
    if (powerTimerRef.current) clearTimeout(powerTimerRef.current);
    toast('Power Dialer paused');
  };

  const resumePowerDialer = () => {
    setIsPaused(false);
    toast('Power Dialer resumed');
    // If not in a call, dial the current lead immediately
    if (!['trying', 'ringing', 'active'].includes(voice.primaryCallState)) {
      handleDial();
    }
  };

  const stopPowerDialer = () => {
    setIsPowerRunning(false);
    setIsPaused(false);
    if (powerTimerRef.current) clearTimeout(powerTimerRef.current);
    toast('Power Dialer stopped');
  };

  const handleDisposition = async (
    dispositionLabel: string
  ) => {
    if (!currentLead) return;
    setIsDisposing(true);

    try {
      const dispValue = DISPOSITIONS.find(d => d.label === dispositionLabel)?.value || 'no_answer';

// Build notes
      const finalNotes = notes;
      
      // Log the full call event, duration, and disposition to our calls API
      const callDuration = typeof voice.primaryCallDuration === 'number' ? voice.primaryCallDuration : 0;
      console.log('[CampaignDialer] Saving call - duration:', callDuration, 'disposition:', dispValue);

      await callsApi.log({
        lead_id: currentLead.id,
        campaign_id: campaign?.id || '',
        duration_seconds: callDuration,
        status: 'completed',
        disposition: dispValue,
        notes: finalNotes,
        provider: campaign?.provider || 'telnyx',
      });

      // Update lead status
      await leadsApi.updateDisposition(currentLead.id, dispValue);

      toast.success(`Marked as ${dispositionLabel}`);
      setShowDisposition(false);

      // Auto-advance to next lead after successful disposition
      if (isPowerRunning && !isPaused && autoNextEnabled) {
        navigateNext();
        dialNextLeadAfterDelay();
      } else {
        navigateNext();
      }

    } catch {
      toast.error('Failed to save disposition');
    } finally {
      setIsDisposing(false);
    }
  };

  const handleDemoBooked = async (data: {
    demoDate: string;
    demoTime: string;
    timezone: string;
    meetingPlatform: string;
    meetingLink: string;
    notes: string;
  }) => {
    if (!currentLead) return;
    setIsDisposing(true);

    try {
      const callDuration = typeof voice.primaryCallDuration === 'number' ? voice.primaryCallDuration : 0;
      
      // Log the call
      await callsApi.log({
        lead_id: currentLead.id,
        campaign_id: campaign?.id || '',
        duration_seconds: callDuration,
        status: 'completed',
        disposition: 'demo_booked',
        notes: data.notes || notes,
        provider: campaign?.provider || 'telnyx',
      });

      // Log the disposition payload for verification
      console.log('Disposition payload:', {
        status: 'demo_booked',
        demo_date: data.demoDate,
        demo_time: data.demoTime,
        timezone: data.timezone,
        meeting_platform: data.meetingPlatform,
        meeting_link: data.meetingLink,
        notes: data.notes,
      });

      // Update lead with demo details
      await leadsApi.updateDisposition(currentLead.id, 'demo_booked', {
        demo_date: data.demoDate,
        demo_time: data.demoTime,
        timezone: data.timezone,
        meeting_platform: data.meetingPlatform,
        meeting_link: data.meetingLink,
        notes: data.notes,
      });

      toast.success('Demo booked successfully.');
      setShowDemoModal(false);
      setShowDisposition(false);

      if (isPowerRunning && !isPaused && autoNextEnabled) {
        navigateNext();
        dialNextLeadAfterDelay();
      } else {
        navigateNext();
      }

    } catch {
      toast.error('Failed to save demo booking');
    } finally {
      setIsDisposing(false);
    }
  };

  const handleCallbackScheduled = async (data: {
    callbackDate: string;
    callbackTime: string;
    timezone: string;
    notes: string;
  }) => {
    if (!currentLead) return;
    setIsDisposing(true);

    try {
      const callDuration = typeof voice.primaryCallDuration === 'number' ? voice.primaryCallDuration : 0;
      
      // Log the call
      await callsApi.log({
        lead_id: currentLead.id,
        campaign_id: campaign?.id || '',
        duration_seconds: callDuration,
        status: 'completed',
        disposition: 'callback',
        notes: data.notes || notes,
        provider: campaign?.provider || 'telnyx',
      });

      // Log the disposition payload for verification
      console.log('Disposition payload:', {
        status: 'callback',
        callback_date: data.callbackDate,
        callback_time: data.callbackTime,
        timezone: data.timezone,
        notes: data.notes,
      });

      // Update lead with callback details
      await leadsApi.updateDisposition(currentLead.id, 'callback', {
        callback_date: data.callbackDate,
        callback_time: data.callbackTime,
        timezone: data.timezone,
        notes: data.notes,
      });

      toast.success('Callback scheduled.');
      setShowCallbackModal(false);
      setShowDisposition(false);

      if (isPowerRunning && !isPaused && autoNextEnabled) {
        navigateNext();
        dialNextLeadAfterDelay();
      } else {
        navigateNext();
      }

    } catch {
      toast.error('Failed to save callback');
    } finally {
      setIsDisposing(false);
    }
  };

  const markMeetingBooked = async () => {
    if (!currentLead) return;
    try {
      await leadsApi.updateDisposition(currentLead.id, 'answered');
      toast.success('🎉 Meeting Booked & Saved!');
      triggerSwipeLeft();
    } catch {
      toast.error('Failed to book meeting');
    }
  }

  // --- Framer Motion Swipe Physics ---
  const controls = useAnimation();
  const handleDragEnd = async (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const swipeThreshold = 100; // px

    // Swipe Up: Book Meeting
    if (info.offset.y < -swipeThreshold && Math.abs(info.offset.y) > Math.abs(info.offset.x)) {
      await controls.start({ y: -1000, opacity: 0, transition: { duration: 0.3 } });
      markMeetingBooked();
      controls.set({ x: 0, y: 0, opacity: 1 });
    }
    // Swipe Left: Next Lead (Navigate forward)
    else if (info.offset.x < -swipeThreshold) {
      await controls.start({ x: -1000, opacity: 0, transition: { duration: 0.3 } });
      navigateNext();
      controls.set({ x: 0, y: 0, opacity: 1 });
    }
    // Swipe Right: Previous Lead (Navigate backwards)
    else if (info.offset.x > swipeThreshold) {
      await controls.start({ x: 1000, opacity: 0, transition: { duration: 0.3 } });
      navigatePrev();
      controls.set({ x: 0, y: 0, opacity: 1 });
    }
    // Snap back
    else {
      controls.start({ x: 0, y: 0, opacity: 1, transition: { type: 'spring', bounce: 0.4 } });
    }
  };

  const triggerSwipeLeft = async () => {
    await controls.start({ x: -1000, opacity: 0, transition: { duration: 0.3 } });
    navigateNext();
    controls.set({ x: 0, y: 0, opacity: 1 });
  }

  // Early returns
  if (!campaignId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center" style={{ fontFamily: INTER_FONT }}>
        <AlertCircle className="h-12 w-12 text-[#9CA3AF] mb-4" />
        <h2 className="text-xl font-semibold text-[#111827]">No campaign selected</h2>
      </div>
    );
  }
  if (isLoading) return (
    <div className="flex justify-center py-40" style={{ fontFamily: INTER_FONT }}>
      <Loader2 className="h-8 w-8 animate-spin text-[#111827]" />
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto" style={{ fontFamily: INTER_FONT }}>
        <AlertCircle className="h-12 w-12 text-[#EF4444] mb-4" />
        <h2 className="text-2xl font-bold text-[#111827] mb-2">Error Loading Dialer</h2>
        <p className="text-[#6B7280] mb-6">{error}</p>
        <button onClick={() => navigate('/login')} className="bg-[#111827] hover:bg-black text-white px-6 py-2.5 rounded-xl transition-colors font-medium">Re-authenticate</button>
      </div>
    );
  }

  if (leads.length === 0) return (
    <div className="text-center py-40" style={{ fontFamily: INTER_FONT }}>
      <h2 className="text-2xl font-bold text-[#111827]">All leads dialed!</h2>
    </div>
  );

  // Helper: check if a lead has already been dialed
  const isLeadDialed = (lead: Lead) => lead.status !== 'new' && lead.status !== 'calling';

  const isInCall = ['trying', 'ringing', 'active'].includes(voice.primaryCallState);
  const completed = calledLeadsCount;
  const remaining = Math.max(0, totalLeadsCount - calledLeadsCount);
  const progressPct = totalLeadsCount > 0 ? Math.round((completed / totalLeadsCount) * 100) : 0;
  const initials = `${currentLead?.first_name?.[0] ?? ''}${currentLead?.last_name?.[0] ?? ''}`.toUpperCase();
  const talkingPoints = currentLead ? getTalkingPoints(currentLead) : [];

  const cardClass = 'bg-white rounded-[20px] border border-[#E8EAF0] shadow-[0_1px_3px_rgba(17,24,39,0.04),0_8px_24px_rgba(17,24,39,0.04)]';
  const sectionTitleClass = 'text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]';

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#111827]" style={{ fontFamily: INTER_FONT }}>
      {/* ── Top Header ── */}
      <header className="sticky top-0 z-30 bg-[#F7F8FA]/90 backdrop-blur-md border-b border-[#E8EAF0]">
        <div className="mx-auto max-w-[1600px] px-6 lg:px-10 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => navigate('/campaigns')}
              className="h-10 w-10 shrink-0 rounded-xl border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#111827] flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-bold text-[#111827] truncate">{campaign?.name}</h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#22C55E]/10 text-[#16A34A] text-[11px] font-bold uppercase tracking-wide">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> Active
                </span>
              </div>
              <div className="flex items-center gap-3 text-[13px] text-[#6B7280] mt-0.5">
                {dialerSessionMode === 'power' ? (
                  <span className="inline-flex items-center gap-1.5 font-medium"><Zap className="h-3.5 w-3.5 text-[#F97316]" /> Power Mode</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium"><MousePointerClick className="h-3.5 w-3.5 text-[#6B7280]" /> Click Mode</span>
                )}
                <span className="text-[#D1D5DB]">•</span>
                <span className="font-medium">Lead {currentIndex + 1} of {totalLeadsCount}</span>
              </div>
            </div>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2 shrink-0">
            {campaign?.provider === 'local' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#22C55E]/10 text-[#16A34A] text-xs font-semibold border border-[#22C55E]/20">
                <Smartphone className="h-3.5 w-3.5" /> Local SIM
              </span>
            ) : voice.connectionStatus === 'registered' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E5E7EB] text-xs font-semibold text-[#111827]">
                <span className="h-2 w-2 rounded-full bg-[#22C55E] animate-pulse" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E5E7EB] text-xs font-semibold text-[#6B7280]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting
              </span>
            )}
          </div>
        </div>

        {/* Power Dialer control strip */}
        {dialerSessionMode === 'power' && (
          <div className="mx-auto max-w-[1600px] px-6 lg:px-10 pb-3 flex items-center gap-2 flex-wrap">
            {!isPowerRunning ? (
              <button
                onClick={startPowerDialer}
                className="inline-flex items-center gap-2 bg-[#111827] hover:bg-black text-white px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95"
              >
                <Zap className="h-4 w-4 text-[#F97316]" /> Start Power Dialer
              </button>
            ) : (
              <>
<button onClick={navigatePrev} disabled={currentIndex <= 0} className="inline-flex items-center gap-2 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#111827] px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
                   <ChevronLeft className="h-4 w-4" /> Prev
                 </button>
                 <button onClick={navigateNext} disabled={currentIndex + 1 >= leads.length} className="inline-flex items-center gap-2 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#111827] px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
                   Next <ChevronRight className="h-4 w-4" />
                 </button>
                {isPaused ? (
                  <button onClick={resumePowerDialer} className="inline-flex items-center gap-2 bg-[#22C55E] hover:bg-[#16A34A] text-white px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95">▶ Resume</button>
                ) : (
                  <button onClick={pausePowerDialer} className="inline-flex items-center gap-2 bg-[#F59E0B] hover:bg-[#D97706] text-white px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95">⏸ Pause</button>
                )}
                <button onClick={() => { if (powerTimerRef.current) clearTimeout(powerTimerRef.current); navigateNext(); if (isPowerRunning && !isPaused) { setTimeout(() => handleDial(), 300); } }} className="inline-flex items-center gap-2 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#111827] px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95">⏭ Skip</button>
                <button onClick={stopPowerDialer} className="inline-flex items-center gap-2 bg-[#EF4444] hover:bg-[#DC2626] text-white px-4 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95">⏹ Stop</button>
                <label className="inline-flex items-center gap-2 text-[13px] text-[#6B7280] ml-1">
                  <input
                    type="checkbox"
                    checked={autoNextEnabled}
                    onChange={(e) => setAutoNextEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-[#E5E7EB] text-[#111827] focus:ring-[#111827]/10"
                  />
                  Auto Next
                </label>
                <label className="inline-flex items-center gap-2 text-[13px] text-[#6B7280] ml-1">
                  Delay
                  <select
                    value={powerDelay}
                    onChange={(e) => setPowerDelay(Number(e.target.value))}
                    className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1 text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#111827]/10"
                  >
                    <option value={0}>0s</option>
                    <option value={3}>3s</option>
                    <option value={5}>5s</option>
                    <option value={10}>10s</option>
                    <option value={15}>15s</option>
                  </select>
                </label>
                <span className="text-[13px] font-medium text-[#6B7280]">
                  {isPaused ? 'Paused' : 'Running'} • {currentIndex + 1}/{totalLeadsCount}
                </span>
              </>
            )}
          </div>
        )}
      </header>

      {/* ── Main two-column layout ── */}
      <main className="mx-auto max-w-[1600px] px-6 lg:px-10 py-8 flex flex-col lg:flex-row gap-8 items-start">
        {/* LEFT — Operator Workspace (32%) */}
        <div className="w-full lg:w-[32%] flex flex-col gap-6">
          {/* Campaign Progress */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className={`${cardClass} p-6`}
          >
            <p className={sectionTitleClass}>Campaign Progress</p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <span className="text-[32px] font-bold leading-none text-[#111827]">{currentIndex + 1}</span>
                <span className="text-[18px] font-medium text-[#9CA3AF]"> / {totalLeadsCount}</span>
              </div>
              <span className="text-[13px] font-semibold text-[#6B7280]">{progressPct}% done</span>
            </div>
            <div className="mt-4 h-2.5 w-full rounded-full bg-[#F1F2F6] overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-[#111827]"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#FCFCFD] border border-[#E8EAF0] p-3">
                <p className="text-[12px] font-medium text-[#9CA3AF]">Calls completed</p>
                <p className="text-[16px] font-semibold text-[#111827] mt-0.5">{completed}</p>
              </div>
              <div className="rounded-xl bg-[#FCFCFD] border border-[#E8EAF0] p-3">
                <p className="text-[12px] font-medium text-[#9CA3AF]">Remaining</p>
                <p className="text-[16px] font-semibold text-[#111827] mt-0.5">{remaining}</p>
              </div>
            </div>
          </motion.section>

          {/* Call Outcome */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
            className={`${cardClass} p-6`}
          >
            <p className={sectionTitleClass}>Call Outcome</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {CALL_OUTCOMES.map((o) => (
                <motion.button
                  key={o.label}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    if (o.label === 'Demo Booked') {
                      setShowDemoModal(true);
                    } else if (o.label === 'Callback') {
                      setShowCallbackModal(true);
                    } else {
                      handleDisposition(o.label);
                    }
                  }}
                  disabled={isDisposing}
                  className={`flex items-center justify-center gap-2 rounded-full text-[14px] font-semibold py-3 px-4 transition-all disabled:opacity-50 shadow-sm hover:shadow-md ${
                    o.color === 'bg-green-500' ? 'bg-green-500 text-white hover:bg-green-600' :
                    o.color === 'bg-orange-500' ? 'bg-orange-500 text-white hover:bg-orange-600' :
                    o.color === 'bg-gray-500' ? 'bg-gray-500 text-white hover:bg-gray-600' :
                    o.color === 'bg-blue-500' ? 'bg-blue-500 text-white hover:bg-blue-600' :
                    o.color === 'bg-yellow-500' ? 'bg-yellow-500 text-[#111827] hover:bg-yellow-600' :
                    o.color === 'bg-red-500' ? 'bg-red-500 text-white hover:bg-red-600' :
                    'bg-white border border-[#E5E7EB] text-[#111827] hover:bg-[#F3F4F6]'
                  }`}
                >
                  {o.icon}
                  <span>{o.label}</span>
                </motion.button>
              ))}
            </div>
            <ScheduleDemoModal
              isOpen={showDemoModal}
              onClose={() => setShowDemoModal(false)}
              onSave={handleDemoBooked}
            />
            <ScheduleCallbackModal
              isOpen={showCallbackModal}
              onClose={() => setShowCallbackModal(false)}
              onSave={handleCallbackScheduled}
            />
          </motion.section>

          {/* AI Talking Points */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
            className={`${cardClass} p-6`}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#F97316]" />
              <p className={sectionTitleClass}>AI Talking Points</p>
            </div>
            <ul className="mt-4 space-y-3">
              {talkingPoints.map((pt, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }}
                  className="flex items-start gap-2.5 text-[14px] text-[#374151]"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F97316]" />
                  {pt}
                </motion.li>
              ))}
            </ul>
          </motion.section>

          {/* Previous Notes */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
            className={`${cardClass} p-6`}
          >
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-[#9CA3AF]" />
              <p className={sectionTitleClass}>Previous Notes</p>
            </div>
            <div className="mt-4 max-h-44 overflow-y-auto pr-1 space-y-3">
              {currentLead?.notes ? (
                <div className="relative pl-5">
                  <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[#22C55E]" />
                  <span className="absolute left-[3px] top-3 bottom-0 w-px bg-[#E8EAF0]" />
                  <p className="text-[13px] text-[#6B7280] whitespace-pre-wrap leading-relaxed">{currentLead.notes}</p>
                </div>
              ) : (
                <p className="text-[13px] text-[#9CA3AF] italic">No previous notes for this lead.</p>
              )}
            </div>
          </motion.section>
        </div>

        {/* RIGHT — Contact + Scratchpad (68%) */}
        <div className="w-full lg:w-[68%] flex flex-col gap-6 relative">
          {/* Contact Card */}
          <motion.section
            key={currentLead?.id}
            drag={!isInCall && !showDisposition}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            onDragEnd={handleDragEnd}
            animate={controls}
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className={`${cardClass} p-8 cursor-grab active:cursor-grabbing select-none`}
          >
            <div className="flex items-start gap-6">
              {/* Avatar */}
              <div className="relative">
                <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-[#111827] to-[#374151] text-white flex items-center justify-center text-[26px] font-bold shadow-sm">
                  {initials || <UserPlaceholder />}
                </div>
                {isLeadDialed(currentLead) && (
                  <span className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-[#22C55E] text-white flex items-center justify-center shadow-md border-2 border-white">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-[32px] font-bold leading-tight text-[#111827] truncate">
                  {currentLead?.first_name} {currentLead?.last_name || ''}
                </h2>
                {currentLead?.company && (
                  <p className="text-[18px] font-medium text-[#6B7280] mt-1">{currentLead.company}</p>
                )}
              </div>
            </div>

            {/* Big phone number — the focal point, clickable to dial */}
            <button
              onClick={(e) => { e.stopPropagation(); if (!isInCall) handleDial(); }}
              className="mt-7 w-full flex items-center justify-center gap-3 rounded-2xl bg-[#F7F8FA] border border-[#E8EAF0] hover:border-[#F97316] hover:bg-[#FFF7ED] py-5 transition-colors group"
            >
              <Phone className="h-6 w-6 text-[#F97316] group-hover:scale-110 transition-transform" />
              <span className="text-[34px] font-bold tracking-tight text-[#111827] font-mono">
                {currentLead?.phone || '—'}
              </span>
            </button>

            {/* Detail rows with icons (no ALL CAPS labels) */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              {currentLead?.company && (
                <ContactRow icon={<BuildingIcon />} value={currentLead.company} />
              )}
              {currentLead?.website && (
                <ContactRow
                  icon={<Globe className="h-4 w-4 text-[#9CA3AF]" />}
                  value={currentLead.website.replace(/^https?:\/\//, '')}
                  href={currentLead.website}
                />
              )}
              {(currentLead?.city || currentLead?.state) && (
                <ContactRow
                  icon={<MapPin className="h-4 w-4 text-[#9CA3AF]" />}
                  value={[currentLead.city, currentLead.state, currentLead.zip].filter(Boolean).join(', ')}
                />
              )}
              {currentLead?.email && (
                <ContactRow icon={<Mail className="h-4 w-4 text-[#9CA3AF]" />} value={currentLead.email} href={`mailto:${currentLead.email}`} />
              )}
              {(currentLead?.google_rating != null) && (
                <ContactRow
                  icon={<Star className="h-4 w-4 text-[#F59E0B] fill-[#F59E0B]" />}
                  value={`${currentLead.google_rating} · ${currentLead.review_count ?? 0} reviews`}
                />
              )}
            </div>
          </motion.section>

          {/* Scratchpad */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
            className={`${cardClass} p-6`}
          >
            <div className="flex items-center justify-between">
              <p className={sectionTitleClass}>Scratchpad</p>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#9CA3AF]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> Saves with outcome
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write notes during the conversation..."
              className="mt-3 w-full min-h-[140px] resize-none rounded-xl bg-[#FCFCFD] border border-[#E8EAF0] p-4 text-[15px] text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#111827]/10 focus:border-[#E5E7EB] transition-colors"
            />
          </motion.section>

          {/* In-Call HUD overlay (timer + visualizer + DTMF) */}
          <InCallHUD
            callState={voice.primaryCallState}
            callDuration={voice.primaryCallDuration}
            remoteStream={voice.primaryCall?.remoteStream || null}
            showDTMF={showDTMF}
            onSendDTMF={voice.sendDTMF}
          />

{/* Post-Call Disposition overlay */}
           <DispositionOverlay
             visible={showDisposition}
             dispositions={DISPOSITIONS}
             isDisposing={isDisposing}
             onSelect={handleDisposition}
             onScheduleDemo={() => setShowDemoModal(true)}
             onScheduleCallback={() => setShowCallbackModal(true)}
           />
        </div>
      </main>

      {/* ── Sticky Bottom Action Bar ── */}
      <div className="sticky bottom-0 z-30 border-t border-[#E8EAF0] bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-[1600px] px-6 lg:px-10 py-4 flex items-center justify-between gap-4">
          <button
            onClick={navigatePrev}
            disabled={currentIndex <= 0}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#111827] font-semibold px-5 py-3.5 transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-5 w-5" /> Previous
          </button>

          {isInCall ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDTMF(!showDTMF)}
                className="h-14 w-14 rounded-2xl border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#111827] flex items-center justify-center transition-colors active:scale-95"
              >
                <Hash className="h-6 w-6" />
              </button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleHangUp}
                className="inline-flex items-center gap-3 rounded-2xl bg-[#EF4444] hover:bg-[#DC2626] text-white font-bold text-lg px-10 py-3.5 shadow-[0_0_30px_rgba(239,68,68,0.35)] transition-colors"
              >
                <PhoneOff className="h-6 w-6" /> Hang Up
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleDial}
              className="inline-flex items-center gap-3 rounded-2xl bg-[#111827] hover:bg-black text-white font-bold text-lg px-12 py-3.5 shadow-[0_0_30px_rgba(249,115,22,0.35)] transition-colors"
            >
              <Phone className="h-6 w-6" /> Dial Now
            </motion.button>
          )}

          <button
            onClick={navigateNext}
            disabled={currentIndex + 1 >= leads.length}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#111827] font-semibold px-5 py-3.5 transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Hidden audio element for remote stream playback */}
      {voice.primaryCall?.remoteStream && (
        <audio autoPlay ref={(el) => { if (el && voice.primaryCall?.remoteStream) { el.srcObject = voice.primaryCall.remoteStream; } }} />
      )}
      
      {/* Campaign Complete Modal */}
      <AnimatePresence>
        {showCampaignComplete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[28px] p-8 max-w-md w-full"
            >
              <div className="text-center">
                <div className="text-6xl mb-4">🎉</div>
                <h2 className="text-2xl font-bold text-[#111827] mb-6">Campaign Complete</h2>
                
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">Calls completed</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.completed}</p>
                  </div>
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">Demo booked</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.demoBooked}</p>
                  </div>
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">Callbacks</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.callbacks}</p>
                  </div>
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">Voicemails</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.voicemails}</p>
                  </div>
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">No Answers</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.noAnswers}</p>
                  </div>
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">Wrong Numbers</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.wrongNumbers}</p>
                  </div>
                  <div className="bg-[#FCFCFD] border border-[#E8EAF0] rounded-xl p-4">
                    <p className="text-[12px] font-medium text-[#9CA3AF]">Not Interested</p>
                    <p className="text-[24px] font-bold text-[#111827]">{campaignStats.notInterested}</p>
                  </div>
                </div>
                
                <button
                  onClick={() => navigate('/campaigns')}
                  className="inline-flex items-center justify-center rounded-xl bg-[#111827] hover:bg-black text-white font-semibold px-6 py-3 transition-colors"
                >
                  Return to Campaigns
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Small presentational helpers ──
function ContactRow({ icon, value, href }: { icon: React.ReactNode; value: string; href?: string }) {
  const content = (
    <div className="flex items-center gap-3 py-1 group">
      <span className="shrink-0">{icon}</span>
      <span className="text-[15px] font-medium text-[#374151] truncate group-hover:text-[#111827] transition-colors">{value}</span>
    </div>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">
        {content}
      </a>
    );
  }
  return content;
}

function BuildingIcon() {
  return (
    <svg className="h-4 w-4 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
    </svg>
  );
}

function UserPlaceholder() {
  return (
    <svg className="h-9 w-9 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
