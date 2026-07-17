import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, CheckCircle2, Filter } from 'lucide-react';
import { leadsApi } from '@/lib/api';
import type { Lead } from '@/lib/api';
import { toast } from 'sonner';
import { convertClientScheduleToIST, formatDate, getLocationLabel, getLocationFromTimezone } from '@/lib/timezone';

type FollowUpFilter = 'all' | 'demo_booked' | 'callback' | 'answered' | 'today' | 'tomorrow' | 'week' | 'overdue' | 'completed';

function getISTNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function getISTDate(): string {
  const istNow = getISTNow();
  return formatDate(istNow);
}

function getISTTimeDate(daysOffset: number): string {
  const istNow = getISTNow();
  istNow.setDate(istNow.getDate() + daysOffset);
  return formatDate(istNow);
}

function getISOWeekStart(): string {
  const istNow = getISTNow();
  const day = istNow.getDay();
  const diff = istNow.getDate() - day;
  istNow.setDate(diff);
  return formatDate(istNow);
}

function getISOWeekEnd(): string {
  const istNow = getISTNow();
  const day = istNow.getDay();
  const diff = istNow.getDate() - day;
  istNow.setDate(diff + 6);
  return formatDate(istNow);
}

function isISOToday(date: string): boolean {
  const istToday = getISTDate();
  return date === istToday;
}

function isISTTomorrow(date: string): boolean {
  const tomorrow = getISTTimeDate(1);
  return date === tomorrow;
}

function isISTThisWeek(date: string): boolean {
  const weekStart = getISOWeekStart();
  const weekEnd = getISOWeekEnd();
  return date >= weekStart && date <= weekEnd;
}

function isISTOverdue(date: string): boolean {
  const istToday = getISTDate();
  if (!date) return false;
  const parts = date.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!parts) return false;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const istDate = new Date(
    parts[3] + '-' + (months.indexOf(parts[2]) + 1).toString().padStart(2, '0') + '-' + parts[1].padStart(2, '0')
  );
  return istDate < new Date(istToday);
}

function parseTimeToDate(istDate: string, istTime: string): Date {
  if (!istDate || !istTime) return new Date(NaN);
  const match = istTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return new Date(NaN);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = istDate.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!parts) return new Date(NaN);
  const day = parseInt(parts[1], 10);
  const month = months.indexOf(parts[2]);
  const year = parseInt(parts[3], 10);
  let hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return new Date(year, month, day, hours, mins);
}

function isLeadToday(lead: Lead): boolean {
  if (lead.demo_date) {
    const demoIST = convertClientScheduleToIST(lead.demo_date, lead.demo_time, lead.timezone);
    return isISOToday(demoIST.istDate);
  }
  if (lead.callback_date) {
    const callbackIST = convertClientScheduleToIST(lead.callback_date, lead.callback_time, lead.timezone);
    return isISOToday(callbackIST.istDate);
  }
  return false;
}

function isLeadTomorrow(lead: Lead): boolean {
  if (lead.demo_date) {
    const demoIST = convertClientScheduleToIST(lead.demo_date, lead.demo_time, lead.timezone);
    return isISTTomorrow(demoIST.istDate);
  }
  if (lead.callback_date) {
    const callbackIST = convertClientScheduleToIST(lead.callback_date, lead.callback_time, lead.timezone);
    return isISTTomorrow(callbackIST.istDate);
  }
  return false;
}

function isLeadThisWeek(lead: Lead): boolean {
  if (lead.demo_date) {
    const demoIST = convertClientScheduleToIST(lead.demo_date, lead.demo_time, lead.timezone);
    return isISTThisWeek(demoIST.istDate);
  }
  if (lead.callback_date) {
    const callbackIST = convertClientScheduleToIST(lead.callback_date, lead.callback_time, lead.timezone);
    return isISTThisWeek(callbackIST.istDate);
  }
  return false;
}

function isLeadOverdue(lead: Lead): boolean {
  if (lead.demo_date) {
    const demoIST = convertClientScheduleToIST(lead.demo_date, lead.demo_time, lead.timezone);
    return isISTOverdue(demoIST.istDate);
  }
  if (lead.callback_date) {
    const callbackIST = convertClientScheduleToIST(lead.callback_date, lead.callback_time, lead.timezone);
    return isISTOverdue(callbackIST.istDate);
  }
  return false;
}

function isLeadCompleted(lead: Lead): boolean {
  return !lead.demo_date && !lead.callback_date;
}

function getISTSortTime(lead: Lead): number {
  if (lead.demo_date) {
    const demoIST = convertClientScheduleToIST(lead.demo_date, lead.demo_time, lead.timezone);
    if (!demoIST.istDate) return Infinity;
    return parseTimeToDate(demoIST.istDate, demoIST.istTime).getTime();
  }
  if (lead.callback_date) {
    const callbackIST = convertClientScheduleToIST(lead.callback_date, lead.callback_time, lead.timezone);
    if (!callbackIST.istDate) return Infinity;
    return parseTimeToDate(callbackIST.istDate, callbackIST.istTime).getTime();
  }
  return Infinity;
}

export default function FollowUpsPage() {
  const [followUps, setFollowUps] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FollowUpFilter>('all');

  useEffect(() => {
    const loadFollowUps = async () => {
      setIsLoading(true);
      try {
        const { data } = await leadsApi.getFollowUps();
        setFollowUps(data || []);
      } catch {
        toast.error('Failed to load follow-ups');
      } finally {
        setIsLoading(false);
      }
    };
    loadFollowUps();
  }, []);

  const filteredFollowUps = useMemo(() => {
    let result = [...followUps];

    switch (filter) {
      case 'today':
        result = result.filter(isLeadToday);
        break;
      case 'tomorrow':
        result = result.filter(isLeadTomorrow);
        break;
      case 'week':
        result = result.filter(isLeadThisWeek);
        break;
      case 'overdue':
        result = result.filter(isLeadOverdue);
        break;
      case 'demo_booked':
      case 'callback':
      case 'answered':
        result = result.filter(lead => lead.status === filter);
        break;
      case 'completed':
        result = result.filter(isLeadCompleted);
        break;
    }

    // Sort: overdue first, then by nearest IST time
    result.sort((a, b) => {
      const aOverdue = isLeadOverdue(a) ? 0 : 1;
      const bOverdue = isLeadOverdue(b) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return getISTSortTime(a) - getISTSortTime(b);
    });

    return result;
  }, [followUps, filter]);

  const renderDateTime = (lead: Lead) => {
    if (lead.demo_date) {
      const demoIST = convertClientScheduleToIST(lead.demo_date, lead.demo_time, lead.timezone);
      const locationLabel = lead.timezone ? getLocationLabel(getLocationFromTimezone(lead.timezone)) : '';
      return (
        <div className="space-y-2">
          <div>
            <p className="text-xs font-semibold text-[#6B7280] mb-1">Customer Schedule</p>
            <p className="text-sm text-[#111827]">
              {demoIST.customerDate} at {demoIST.customerTime}
            </p>
            {lead.timezone && <p className="text-xs text-[#9CA3AF]">{locationLabel} • {lead.timezone}</p>}
          </div>
          {demoIST.istDate && (
            <div>
              <p className="text-xs font-semibold text-[#6B7280] mb-1">Indian Team</p>
              <p className="text-sm text-[#111827]">
                {demoIST.istDate} at {demoIST.istTime}
              </p>
            </div>
          )}
          {lead.meeting_platform && (
            <p className="text-xs text-[#9CA3AF] mt-1">{lead.meeting_platform}</p>
          )}
        </div>
      );
    }
    if (lead.callback_date) {
      const callbackIST = convertClientScheduleToIST(lead.callback_date, lead.callback_time, lead.timezone);
      const locationLabel = lead.timezone ? getLocationLabel(getLocationFromTimezone(lead.timezone)) : '';
      return (
        <div className="space-y-2">
          <div>
            <p className="text-xs font-semibold text-[#6B7280] mb-1">Customer Schedule</p>
            <p className="text-sm text-[#111827]">
              {callbackIST.customerDate} at {callbackIST.customerTime}
            </p>
            {lead.timezone && <p className="text-xs text-[#9CA3AF]">{locationLabel} • {lead.timezone}</p>}
          </div>
          {callbackIST.istDate && (
            <div>
              <p className="text-xs font-semibold text-[#6B7280] mb-1">Indian Team</p>
              <p className="text-sm text-[#111827]">
                {callbackIST.istDate} at {callbackIST.istTime}
              </p>
            </div>
          )}
        </div>
      );
    }
    return <span className="text-[#9CA3AF]">—</span>;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 border-2 border-foreground/20 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-[#111827]">Follow Ups</h1>
          <span className="text-sm text-[#6B7280]">{filteredFollowUps.length} scheduled</span>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[#6B7280]" />
          <label className="text-sm font-medium text-[#6B7280]">Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FollowUpFilter)}
            className="border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/10"
          >
            <option value="all">All</option>
            <option value="today">Today (IST)</option>
            <option value="tomorrow">Tomorrow (IST)</option>
            <option value="week">This Week (IST)</option>
            <option value="overdue">Overdue</option>
            <option value="demo_booked">Demo Booked</option>
            <option value="callback">Callback</option>
            <option value="answered">Interested</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {filteredFollowUps.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-[#E5E7EB]">
          <CalendarDays className="h-12 w-12 text-[#9CA3AF] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#111827] mb-2">No follow-ups scheduled</h3>
          <p className="text-[#6B7280]">All caught up! Check back after making some calls.</p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden"
        >
          {/* Table Header */}
          <div className="grid grid-cols-5 gap-4 px-6 py-4 border-b border-[#E5E7EB] bg-[#F9FAFB] text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            <div className="col-span-2">Contact</div>
            <div>Phone</div>
            <div>Type</div>
            <div>Date & Time</div>
            <div>Status</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-[#E5E7EB]">
            {filteredFollowUps.map((lead, index) => (
              <motion.div
                key={lead.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="grid grid-cols-5 gap-4 px-6 py-4 items-center hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="col-span-2 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#111827] to-[#374151] text-white flex items-center justify-center text-sm font-bold">
                    {lead.first_name?.[0]}{lead.last_name?.[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-[#111827]">
                      {lead.first_name} {lead.last_name}
                    </p>
                    <p className="text-sm text-[#6B7280]">{lead.company}</p>
                  </div>
                </div>
                <div className="font-mono text-[#111827]">{lead.phone}</div>
                <div>
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                    lead.status === 'demo_booked' ? 'bg-green-100 text-green-700' :
                    lead.status === 'callback' ? 'bg-orange-100 text-orange-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {lead.status === 'demo_booked' ? 'Demo' :
                     lead.status === 'callback' ? 'Callback' : 'Interested'}
                  </span>
                </div>
                <div>{renderDateTime(lead)}</div>
                <div>
                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-xs font-medium text-[#111827] hover:bg-[#F3F4F6] transition-colors">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark Done
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
