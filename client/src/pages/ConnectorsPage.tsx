import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Plug, CheckCircle2, XCircle, ArrowRight, Smartphone, Phone, Loader2 } from 'lucide-react';
import { settingsApi } from '@/lib/api';
import type { UserSettings } from '@/lib/api';

interface ConnectorStatus {
  connected: boolean;
  accountName: string;
  phoneNumbers: { phone_number: string; friendly_name: string }[];
  lastTested: string | null;
}

interface TwilioPhoneNumber {
  phone_number: string;
  friendly_name: string;
}

export default function ConnectorsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [telnyxStatus, setTelnyxStatus] = useState<ConnectorStatus>({ connected: false, accountName: '', phoneNumbers: [], lastTested: null });
  const [twilioStatus, setTwilioStatus] = useState<ConnectorStatus>({ connected: false, accountName: '', phoneNumbers: [], lastTested: null });
  
  const [isTelnyxModalOpen, setIsTelnyxModalOpen] = useState(false);
  const [telnyxKey, setTelnyxKey] = useState('');
  const [sipLogin, setSipLogin] = useState('');
  const [sipPassword, setSipPassword] = useState('');
  const [callerNumber, setCallerNumber] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSavingSip, setIsSavingSip] = useState(false);

const [isTwilioModalOpen, setIsTwilioModalOpen] = useState(false);
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [twilioApiKey, setTwilioApiKey] = useState('');
  const [twilioApiSecret, setTwilioApiSecret] = useState('');
  const [twilioTwimlAppSid, setTwilioTwimlAppSid] = useState('');
  const [selectedTwilioCallerNumber, setSelectedTwilioCallerNumber] = useState('');
  const [twilioPhoneNumbers, setTwilioPhoneNumbers] = useState<{ phone_number: string; friendly_name: string }[]>([]);
  const [isLoadingTwilioNumbers, setIsLoadingTwilioNumbers] = useState(false);
  const [isVerifyingTwilio, setIsVerifyingTwilio] = useState(false);
  const [isSavingTwilio, setIsSavingTwilio] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const [settingsRes, telnyxConnectorRes, twilioConnectorRes] = await Promise.all([
        settingsApi.get(),
        settingsApi.getTelnyxConnector(),
        settingsApi.getTwilioConnector()
      ]);
      
      setSettings(settingsRes.data);
      
      if (telnyxConnectorRes.data) {
        setTelnyxStatus(telnyxConnectorRes.data);
        if (settingsRes.data?.telnyx_sip_login) setSipLogin(settingsRes.data.telnyx_sip_login);
        if (settingsRes.data?.telnyx_sip_password) setSipPassword(settingsRes.data.telnyx_sip_password);
        if (settingsRes.data?.telnyx_caller_number) setCallerNumber(settingsRes.data.telnyx_caller_number);
      }
      
      if (twilioConnectorRes.data) {
        setTwilioStatus(twilioConnectorRes.data);
        if (settingsRes.data?.twilio_account_sid) setTwilioAccountSid(settingsRes.data.twilio_account_sid);
        if (settingsRes.data?.twilio_caller_number) {
          setSelectedTwilioCallerNumber(settingsRes.data.twilio_caller_number);
        }
        
        // Fetch Twilio phone numbers if connected and we have auth token
        if (twilioConnectorRes.data.connected && settingsRes.data?.twilio_auth_token) {
          setIsLoadingTwilioNumbers(true);
          try {
            const numbersRes = await settingsApi.getTwilioNumbers();
            if (numbersRes.data) {
              const numbers = numbersRes.data as TwilioPhoneNumber[];
              setTwilioPhoneNumbers(numbers);
              
              // Auto-select logic
              if (numbers.length === 1) {
                setSelectedTwilioCallerNumber(numbers[0].phone_number);
              } else if (settingsRes.data?.twilio_caller_number) {
                // Pre-select saved default
                setSelectedTwilioCallerNumber(settingsRes.data.twilio_caller_number);
              }
            }
          } catch (error) {
            console.error('Failed to fetch Twilio numbers:', error);
          } finally {
            setIsLoadingTwilioNumbers(false);
          }
        }
      }
    } catch (error: unknown) {
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const hasTelnyxKey = !!settings?.telnyx_api_key;
  const hasTwilioKey = !!settings?.twilio_account_sid;

  const handleVerifyTelnyx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!telnyxKey.trim()) {
      toast.error('API Key cannot be empty');
      return;
    }

    setIsVerifying(true);
    try {
      const response = await settingsApi.verifyTelnyxKey(telnyxKey);
      if (response.data?.success) {
        toast.success(response.data.message || 'Telnyx connected successfully!');
        setIsTelnyxModalOpen(false);
        setTelnyxKey('');
        fetchSettings();
      } else {
        toast.error(response.data?.message || 'Invalid Telnyx API Key');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      toast.error(message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveSipCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sipLogin.trim() || !sipPassword.trim()) {
      toast.error('SIP Login and Password are required');
      return;
    }
    setIsSavingSip(true);
    try {
      await settingsApi.update({
        telnyx_sip_login: sipLogin,
        telnyx_sip_password: sipPassword,
        telnyx_caller_number: callerNumber || undefined,
      });
      toast.success('SIP credentials saved!');
      fetchSettings();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save SIP credentials';
      toast.error(message);
    } finally {
      setIsSavingSip(false);
    }
  };

  const handleVerifyTwilio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twilioAccountSid.trim() || !twilioAuthToken.trim()) {
      toast.error('Account SID and Auth Token are required');
      return;
    }
    setIsVerifyingTwilio(true);
    try {
      const result = await settingsApi.verifyTwilio(twilioAccountSid, twilioAuthToken);
      toast.success(result.data?.message || 'Twilio credentials verified!');
      
      // Fetch Twilio phone numbers after successful verification
      setIsLoadingTwilioNumbers(true);
      try {
        const numbersRes = await settingsApi.getTwilioNumbers();
        if (numbersRes.data) {
          const numbers = numbersRes.data as TwilioPhoneNumber[];
          setTwilioPhoneNumbers(numbers);
          
          // Auto-select logic
          if (numbers.length === 1) {
            setSelectedTwilioCallerNumber(numbers[0].phone_number);
          } else if (settings?.twilio_caller_number) {
            setSelectedTwilioCallerNumber(settings.twilio_caller_number);
          }
        }
      } catch (error) {
        console.error('Failed to fetch Twilio numbers:', error);
      } finally {
        setIsLoadingTwilioNumbers(false);
      }
      
      fetchSettings();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setIsVerifyingTwilio(false);
    }
  };

  const handleSaveTwilioCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twilioApiKey.trim() || !twilioApiSecret.trim() || !twilioTwimlAppSid.trim()) {
      toast.error('API Key, API Secret, and TwiML App SID are all required');
      return;
    }
    
    // Validate that a caller number is selected (required for outbound calls)
    if (twilioPhoneNumbers.length > 0 && !selectedTwilioCallerNumber) {
      toast.error('Please select a default caller ID number');
      return;
    }
    
    // DEBUG: Log the selected value and payload
    console.log("=== DEBUG: Twilio Save ===");
    console.log("Selected caller number:", selectedTwilioCallerNumber);
    console.log("Type:", typeof selectedTwilioCallerNumber);
    console.log("Is empty string:", selectedTwilioCallerNumber === "");
    console.log("twilioPhoneNumbers.length:", twilioPhoneNumbers.length);
    
    const payload = {
      twilio_api_key: twilioApiKey,
      twilio_api_secret: twilioApiSecret,
      twilio_twiml_app_sid: twilioTwimlAppSid,
      twilio_caller_number: selectedTwilioCallerNumber || undefined,
    };
    
    console.log("PUT /settings payload:", payload);
    console.log("JSON body:", JSON.stringify(payload));
    console.log("============================");
    
    setIsSavingTwilio(true);
    try {
      await settingsApi.update(payload);
      toast.success('Twilio WebRTC credentials saved!');
      fetchSettings();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Twilio credentials');
    } finally {
      setIsSavingTwilio(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Connectors</h1>
        <p className="text-muted-foreground">Manage your external telephony integrations.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Telnyx Card */}
        <div className="relative overflow-hidden rounded-[1.5rem] border border-black/5 dark:border-white/5 bg-surface p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
          <div className="flex items-start justify-between">
            <div className="h-12 w-12 rounded-[0.85rem] bg-foreground flex items-center justify-center text-background font-bold text-lg mb-4 shadow-sm">
               Tx
            </div>
            <div className="flex flex-col items-end gap-2">
              {telnyxStatus.connected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-wider text-foreground border border-black/10 dark:border-white/10 shadow-sm">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500 border border-red-500/20">
                  <XCircle className="h-3 w-3" />
                  Not Connected
                </span>
              )}
              {telnyxStatus.phoneNumbers.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground border border-border mt-1">
                  <Phone className="h-3.5 w-3.5" />
                  {telnyxStatus.phoneNumbers.length} Number{telnyxStatus.phoneNumbers.length > 1 ? 's' : ''}
                </span>
              )}
              {telnyxStatus.lastTested && (
                <span className="text-xs text-muted-foreground mt-1">
                  Last tested: {new Date(telnyxStatus.lastTested).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          
          <h3 className="text-xl font-bold text-foreground mb-2">Telnyx WebRTC</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Power outbound dialing and live call tracking directly from the browser using standard WebRTC.
          </p>
          
          <button
            onClick={() => setIsTelnyxModalOpen(true)}
            className="group flex w-full items-center justify-between rounded-[0.85rem] bg-foreground text-background px-4 py-3.5 text-sm font-medium transition-all hover:opacity-90 shadow-sm"
          >
            {telnyxStatus.connected ? 'Update Configuration' : 'Connect Telnyx'}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        {/* Twilio Card */}
        <div className="relative overflow-hidden rounded-[1.5rem] border border-black/5 dark:border-white/5 bg-surface p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
          <div className="flex items-start justify-between">
            <div className="h-12 w-12 rounded-[0.85rem] bg-[#F22F46] flex items-center justify-center text-white font-bold text-lg mb-4 shadow-sm">
               Tw
            </div>
            <div className="flex flex-col items-end gap-2">
              {twilioStatus.connected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-wider text-foreground border border-black/10 dark:border-white/10 shadow-sm">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500 border border-red-500/20">
                  <XCircle className="h-3 w-3" />
                  Not Connected
                </span>
              )}
              {twilioStatus.phoneNumbers.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground border border-border mt-1">
                  <Phone className="h-3.5 w-3.5" />
                  {twilioStatus.phoneNumbers.length} Number{twilioStatus.phoneNumbers.length > 1 ? 's' : ''}
                </span>
              )}
              {twilioStatus.lastTested && (
                <span className="text-xs text-muted-foreground mt-1">
                  Last tested: {new Date(twilioStatus.lastTested).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          
          <h3 className="text-xl font-bold text-foreground mb-2">Twilio Voice</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Route calls via Twilio Voice API. Reliable international calling with browser-based WebRTC.
          </p>
          
          <button
            onClick={() => setIsTwilioModalOpen(true)}
            className="group flex w-full items-center justify-between rounded-[0.85rem] bg-foreground text-background px-4 py-3.5 text-sm font-medium transition-all hover:opacity-90 shadow-sm"
          >
            {twilioStatus.connected ? 'Update Configuration' : 'Connect Twilio'}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        {/* Local SIM Card */}
        <div className="relative overflow-hidden rounded-[1.5rem] border border-black/5 dark:border-white/5 bg-surface p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
          <div className="flex items-start justify-between">
            <div className="h-12 w-12 rounded-[0.85rem] bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-lg mb-4">
              <Smartphone className="h-6 w-6" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-wider text-foreground border border-black/10 dark:border-white/10 shadow-sm">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Always Ready
            </span>
          </div>

          <h3 className="text-xl font-bold text-foreground mb-2">Local SIM</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Dial via your phone's native dialer. No WebRTC, no credits, no setup.
          </p>

          <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 mb-4">
            <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
              <span className="font-semibold">How it works:</span> When you start a Local SIM campaign, clicking "Call" opens your phone's native dialer with the lead's number. After the call, return to this tab to log the disposition.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-xs text-muted-foreground">No API keys required</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-xs text-muted-foreground">No Telnyx/Twilio credits</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-xs text-muted-foreground">Android recommended</span>
            </div>
          </div>
        </div>
      </div>

      {/* Telnyx Connection Modal */}
      {isTelnyxModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold tracking-display text-foreground flex items-center gap-2">
                  <Plug className="h-5 w-5 text-foreground" />
                  Connect Telnyx
                </h3>
                <button
                  onClick={() => setIsTelnyxModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:bg-muted/80 hover:text-foreground"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-8">
                {/* 1. REST API Form */}
                <form onSubmit={handleVerifyTelnyx} className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground tracking-display mb-1">REST API V2</h4>
                    <p className="text-xs text-muted-foreground tracking-body mb-4">Required for backend synchronization.</p>
                  </div>
                  
                  <div>
                    <label htmlFor="apiKey" className="block text-sm font-medium text-foreground text-opacity-90 mb-1">
                      Telnyx V2 API Key
                    </label>
                    <input
                      type="password"
                      id="apiKey"
                      placeholder="KEY0..."
                      value={telnyxKey}
                      onChange={(e) => setTelnyxKey(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      required
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex w-full items-center justify-center gap-2 rounded-[0.85rem] bg-foreground text-background px-6 py-3 text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
                      disabled={isVerifying || !telnyxKey.trim()}
                    >
                      {isVerifying ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {isVerifying ? 'Verifying...' : (hasTelnyxKey ? 'Update API Key' : 'Verify & Connect')}
                    </button>
                  </div>
                </form>

                <hr className="border-border" />

                {/* 2. WebRTC SIP Form */}
                <form onSubmit={handleSaveSipCreds} className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground tracking-display mb-1">WebRTC (SIP) Connection</h4>
                    <p className="text-xs text-muted-foreground tracking-body mb-4">Required for the browser-based dialer.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label htmlFor="sipLogin" className="block text-sm font-medium text-foreground text-opacity-90 mb-1">
                        SIP Username
                      </label>
                      <input
                        type="text"
                        id="sipLogin"
                        placeholder="my_sip_user"
                        value={sipLogin}
                        onChange={(e) => setSipLogin(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                        required
                      />
                    </div>
                    
                    <div className="col-span-2">
                      <label htmlFor="sipPassword" className="block text-sm font-medium text-foreground text-opacity-90 mb-1">
                        SIP Password
                      </label>
                      <input
                        type="password"
                        id="sipPassword"
                        placeholder="••••••••"
                        value={sipPassword}
                        onChange={(e) => setSipPassword(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                        required
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-foreground text-opacity-90 mb-1">
                        Caller ID Number <span className="text-muted-foreground text-opacity-70 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        id="callerNumber"
                        placeholder="+1234567890"
                        value={callerNumber}
                        onChange={(e) => setCallerNumber(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex w-full items-center justify-center gap-2 rounded-[0.85rem] bg-foreground px-6 py-3 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
                      disabled={isSavingSip || !sipLogin.trim() || !sipPassword.trim()}
                    >
                      {isSavingSip ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {isSavingSip ? 'Saving...' : 'Save SIP Credentials'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Twilio Connection Modal */}
      {isTwilioModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold tracking-display text-foreground flex items-center gap-2">
                  <Plug className="h-5 w-5 text-foreground" />
                  Connect Twilio
                </h3>
                <button
                  onClick={() => setIsTwilioModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[65vh] overflow-y-auto pr-2 space-y-8">
                {/* 1. Account SID + Auth Token */}
                <form onSubmit={handleVerifyTwilio} className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground tracking-display mb-1">Account Credentials</h4>
                    <p className="text-xs text-muted-foreground tracking-body mb-4">From your Twilio Console dashboard.</p>
                  </div>
                  
                  <div>
                    <label htmlFor="twilioSid" className="block text-sm font-medium text-foreground mb-1">Account SID</label>
                    <input
                      type="text"
                      id="twilioSid"
                      placeholder="AC..."
                      value={twilioAccountSid}
                      onChange={(e) => setTwilioAccountSid(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="twilioToken" className="block text-sm font-medium text-foreground mb-1">Auth Token</label>
                    <input
                      type="password"
                      id="twilioToken"
                      placeholder="••••••••"
                      value={twilioAuthToken}
                      onChange={(e) => setTwilioAuthToken(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      required
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex w-full items-center justify-center gap-2 rounded-[0.85rem] bg-foreground text-background px-6 py-3 text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
                      disabled={isVerifyingTwilio || !twilioAccountSid.trim() || !twilioAuthToken.trim()}
                    >
                      {isVerifyingTwilio ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {isVerifyingTwilio ? 'Verifying...' : (hasTwilioKey ? 'Update Credentials' : 'Verify & Connect')}
                    </button>
                  </div>
                </form>

                <hr className="border-border" />

                {/* 2. API Key + Secret + TwiML App */}
                <form onSubmit={handleSaveTwilioCreds} className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground tracking-display mb-1">WebRTC Configuration</h4>
                    <p className="text-xs text-muted-foreground tracking-body mb-4">API Key, Secret, and TwiML App SID for browser dialing.</p>
                  </div>

                  <div>
                    <label htmlFor="twilioApiKey" className="block text-sm font-medium text-foreground mb-1">API Key SID</label>
                    <input
                      type="text"
                      id="twilioApiKey"
                      placeholder="SK..."
                      value={twilioApiKey}
                      onChange={(e) => setTwilioApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="twilioApiSecret" className="block text-sm font-medium text-foreground mb-1">API Secret</label>
                    <input
                      type="password"
                      id="twilioApiSecret"
                      placeholder="••••••••"
                      value={twilioApiSecret}
                      onChange={(e) => setTwilioApiSecret(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="twilioTwiml" className="block text-sm font-medium text-foreground mb-1">TwiML App SID</label>
                    <input
                      type="text"
                      id="twilioTwiml"
                      placeholder="AP..."
                      value={twilioTwimlAppSid}
                      onChange={(e) => setTwilioTwimlAppSid(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Default Caller ID Number <span className="text-muted-foreground font-normal">(Required)</span>
                    </label>
                    
                    {isLoadingTwilioNumbers ? (
                      <div className="flex items-center gap-3 py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Loading verified Twilio numbers...</span>
                      </div>
                    ) : twilioPhoneNumbers.length === 0 ? (
                      <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4">
                        <p className="text-sm text-red-400 font-medium">No verified Twilio phone numbers found.</p>
                        <p className="text-xs text-red-300 mt-1">Add verified numbers in your Twilio Console, then re-verify the connection.</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {twilioPhoneNumbers.map((number) => (
                          <label
                            key={number.phone_number}
                            className="flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-all hover:bg-muted/50"
                          >
                            <input
                              type="radio"
                              name="twilioCallerNumber"
                              value={number.phone_number}
                              checked={selectedTwilioCallerNumber === number.phone_number}
                              onChange={() => setSelectedTwilioCallerNumber(number.phone_number)}
                              className="h-4 w-4 text-primary border-primary focus:ring-primary focus:ring-2"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{number.friendly_name || 'Unnamed'}</p>
                              <p className="text-sm text-muted-foreground font-mono">{number.phone_number}</p>
                            </div>
                            {selectedTwilioCallerNumber === number.phone_number && (
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex w-full items-center justify-center gap-2 rounded-[0.85rem] bg-foreground px-6 py-3 text-sm font-medium text-background transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
                      disabled={
                        isSavingTwilio || 
                        !twilioApiKey.trim() || 
                        !twilioApiSecret.trim() || 
                        !twilioTwimlAppSid.trim() ||
                        (twilioPhoneNumbers.length > 0 && !selectedTwilioCallerNumber)
                      }
                    >
                      {isSavingTwilio ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {isSavingTwilio ? 'Saving...' : 'Save WebRTC Config'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}