import { useState, useEffect, useMemo } from 'react';
import { X, CalendarDays, Clock, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatDate, convertClientTimeToIST, LOCATION_OPTIONS, getTimezoneFromLocation, getLocationLabel, getLocationFromTimezone } from '@/lib/timezone';

export interface ScheduleCallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    callbackDate: string;
    callbackTime: string;
    timezone: string;
    notes: string;
  }) => void;
  initialTimezone?: string;
}

function formatInputDateToDisplay(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return formatDate(d);
  } catch {
    return '';
  }
}

function formatInputTimeToDisplay(timeStr: string): string {
  if (!timeStr) return '';
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch {
    return '';
  }
}

export default function ScheduleCallbackModal({ isOpen, onClose, onSave, initialTimezone }: ScheduleCallbackModalProps) {
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [location, setLocation] = useState('new-york');
  const [notes, setNotes] = useState('');

  const timezone = getTimezoneFromLocation(location);

  useEffect(() => {
    if (isOpen) {
      setCallbackDate('');
      setCallbackTime('');
      setLocation(getLocationFromTimezone(initialTimezone) || 'new-york');
      setNotes('');
    }
  }, [isOpen, initialTimezone]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const istPreview = useMemo(() => {
    if (!callbackDate || !callbackTime || !timezone) {
      return { istDate: '', istTime: '' };
    }
    const displayDate = formatInputDateToDisplay(callbackDate);
    const displayTime = formatInputTimeToDisplay(callbackTime);
    return convertClientTimeToIST(displayDate, displayTime, timezone);
  }, [callbackDate, callbackTime, timezone]);

  const handleSave = () => {
    // Send raw values to API (date is YYYY-MM-DD, time is HH:mm 24-hour)
    // Formatting helpers are only for display/preview
    console.log('Saving callback with payload:', {
      callbackDate,
      callbackTime,
      timezone,
      notes
    });
    onSave({ callbackDate, callbackTime, timezone, notes });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        className="relative bg-white border border-[#E5E7EB] rounded-3xl p-8 w-full max-w-lg mx-4 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-[#111827]">Schedule Callback</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-[#9CA3AF] font-semibold">Callback Date</span>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <input
                  type="date"
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                  className="w-full bg-white border border-[#E5E7EB] rounded-xl pl-10 pr-3 py-2.5 text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/10"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-[#9CA3AF] font-semibold">Callback Time</span>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <input
                  type="time"
                  value={callbackTime}
                  onChange={(e) => setCallbackTime(e.target.value)}
                  className="w-full bg-white border border-[#E5E7EB] rounded-xl pl-10 pr-3 py-2.5 text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/10"
                />
              </div>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-[#9CA3AF] font-semibold">Client Location</span>
            <div className="relative">
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2.5 text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/10 appearance-none"
              >
                {LOCATION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.flag} {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
            </div>
          </label>

          {/* Schedule Preview */}
          {callbackDate && callbackTime && timezone && (
            <div className="border border-[#E5E7EB] rounded-xl p-4 bg-[#F9FAFB]">
              {/* Customer Schedule */}
              <div>
                <p className="text-xs font-semibold text-[#6B7280] mb-2">Customer Schedule</p>
                <p className="text-sm text-[#111827]">
                  {formatInputDateToDisplay(callbackDate)} at {formatInputTimeToDisplay(callbackTime)}
                </p>
                <p className="text-xs text-[#9CA3AF]">
                  {getLocationLabel(location)} • {timezone}
                </p>
              </div>

              {/* Arrow */}
              <div className="flex justify-center my-3">
                <span className="text-[#9CA3AF] text-lg">↓</span>
              </div>

              {/* Indian Team */}
              <div>
                <p className="text-xs font-semibold text-[#6B7280] mb-2">Indian Team</p>
                {istPreview.istDate ? (
                  <>
                    <p className="text-sm text-[#111827]">
                      {istPreview.istDate} at {istPreview.istTime}
                    </p>
                    <p className="text-xs text-[#9CA3AF]">Asia/Kolkata</p>
                  </>
                ) : (
                  <p className="text-sm text-[#9CA3AF]">Unable to calculate IST time</p>
                )}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-[#9CA3AF] font-semibold">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for callback, context, etc."
              className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2.5 text-[#111827] min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-[#111827]/10"
            />
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-white border border-[#E5E7EB] text-[#111827] font-semibold hover:bg-[#F3F4F6] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!callbackDate || !callbackTime}
            className="flex-[2] py-3 rounded-2xl bg-[#F97316] hover:bg-[#D97706] text-white font-bold transition-colors disabled:opacity-50"
          >
            Schedule Callback
          </button>
        </div>
      </motion.div>
    </div>
  );
}