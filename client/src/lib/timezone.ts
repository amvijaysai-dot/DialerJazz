import { toZonedTime, fromZonedTime } from 'date-fns-tz';

// Location options with flags, display names, and IANA timezones
export const LOCATION_OPTIONS: { value: string; label: string; flag: string; timezone: string }[] = [
  // US Timezones
  { value: 'new-york', label: 'New York (Eastern)', flag: '🇺🇸', timezone: 'America/New_York' },
  { value: 'chicago', label: 'Chicago (Central)', flag: '🇺🇸', timezone: 'America/Chicago' },
  { value: 'denver', label: 'Denver (Mountain)', flag: '🇺🇸', timezone: 'America/Denver' },
  { value: 'phoenix', label: 'Phoenix (Arizona)', flag: '🇺🇸', timezone: 'America/Phoenix' },
  { value: 'los-angeles', label: 'Los Angeles (Pacific)', flag: '🇺🇸', timezone: 'America/Los_Angeles' },
  { value: 'anchorage', label: 'Anchorage (Alaska)', flag: '🇺🇸', timezone: 'America/Anchorage' },
  { value: 'honolulu', label: 'Honolulu (Hawaii)', flag: '🇺🇸', timezone: 'Pacific/Honolulu' },
  
  // Canada
  { value: 'toronto', label: 'Toronto', flag: '🇨🇦', timezone: 'America/Toronto' },
  { value: 'vancouver', label: 'Vancouver', flag: '🇨🇦', timezone: 'America/Vancouver' },
  { value: 'calgary', label: 'Calgary', flag: '🇨🇦', timezone: 'America/Calgary' },
  
  // Australia
  { value: 'sydney', label: 'Sydney', flag: '🇦🇺', timezone: 'Australia/Sydney' },
  { value: 'melbourne', label: 'Melbourne', flag: '🇦🇺', timezone: 'Australia/Melbourne' },
  { value: 'brisbane', label: 'Brisbane', flag: '🇦🇺', timezone: 'Australia/Brisbane' },
  { value: 'perth', label: 'Perth', flag: '🇦🇺', timezone: 'Australia/Perth' },
  
  // UK
  { value: 'london', label: 'London', flag: '🇬🇧', timezone: 'Europe/London' },
  
  // New Zealand
  { value: 'auckland', label: 'Auckland', flag: '🇳🇿', timezone: 'Pacific/Auckland' },
];

// Get IANA timezone from location value
export function getTimezoneFromLocation(locationValue: string | null | undefined): string {
  if (!locationValue) return 'America/New_York';
  const option = LOCATION_OPTIONS.find(opt => opt.value === locationValue);
  return option?.timezone || 'America/New_York';
}

// Get display location label from IANA timezone
export function getLocationFromTimezone(timezone: string | null | undefined): string {
  if (!timezone) return 'new-york';
  const option = LOCATION_OPTIONS.find(opt => opt.timezone === timezone);
  return option?.value || 'new-york';
}

// Get location label with flag (for display)
export function getLocationLabel(locationValue: string | null | undefined): string {
  if (!locationValue) return 'New York (Eastern)';
  const option = LOCATION_OPTIONS.find(opt => opt.value === locationValue);
  return option?.label || 'New York (Eastern)';
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  try {
    let d: Date;
    if (typeof date === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const parts = date.split('-');
        d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      } else {
        d = new Date(date);
      }
    } else {
      d = date;
    }
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return '';
  }
}

export function formatTime(time: Date | string | null | undefined): string {
  if (!time) return '';
  try {
    let hours: number, minutes: number;
    if (typeof time === 'string') {
      if (/^\d{1,2}:\d{2}$/.test(time)) {
        const parts = time.split(':');
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
      } else {
        const d = new Date(time);
        if (isNaN(d.getTime())) return '';
        hours = d.getHours();
        minutes = d.getMinutes();
      }
    } else {
      hours = time.getHours();
      minutes = time.getMinutes();
    }
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours || 12;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch {
    return '';
  }
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    return `${formatDate(d)} ${formatTime(d)}`;
  } catch {
    return '';
  }
}

// For modals: takes display format (DD-MMM-YYYY and HH:MM AM/PM) and returns IST
export function convertClientTimeToIST(
  date: string | null | undefined,
  time: string | null | undefined,
  timezone: string | null | undefined
): { istDate: string; istTime: string; istTimezone: string } {
  if (!date || !time || !timezone) {
    return { istDate: '', istTime: '', istTimezone: '' };
  }
  try {
    const dateMatch = date.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!dateMatch) return { istDate: '', istTime: '', istTimezone: '' };

    const day = parseInt(dateMatch[1], 10);
    const monthStr = dateMatch[2];
    const year = parseInt(dateMatch[3], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months.indexOf(monthStr);
    if (month === -1) return { istDate: '', istTime: '', istTimezone: '' };

    const timeMatch = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!timeMatch) return { istDate: '', istTime: '', istTimezone: '' };

    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const period = timeMatch[3]?.toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const clientDate = new Date(year, month, day, hours, minutes);
    if (isNaN(clientDate.getTime())) return { istDate: '', istTime: '', istTimezone: '' };

    const utcInstant = fromZonedTime(clientDate, timezone);
    const istDateTime = toZonedTime(utcInstant, 'Asia/Kolkata');

    const istDate = formatDate(istDateTime);
    const istTime = formatTime(istDateTime);

    const now = new Date();
    const istFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      timeZoneName: 'short'
    });
    const istParts = istFormatter.formatToParts(now);
    const istTzName = istParts.find(p => p.type === 'timeZoneName')?.value || 'IST';

    return {
      istDate: istDate,
      istTime: `${istTime} ${istTzName}`,
      istTimezone: 'Asia/Kolkata'
    };
  } catch {
    return { istDate: '', istTime: '', istTimezone: '' };
  }
}

// For FollowUpsPage: takes ISO format (YYYY-MM-DD and HH:mm) and returns both customer and IST
export function convertClientScheduleToIST(
  date: string | undefined,
  time: string | undefined,
  timezone: string | undefined
): { customerDate: string; customerTime: string; istDate: string; istTime: string } {
  if (!date || !time || !timezone) {
    return { customerDate: '', customerTime: '', istDate: '', istTime: '' };
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) return { customerDate: '', customerTime: '', istDate: '', istTime: '' };

  const [, year, month, day] = dateMatch;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!timeMatch) return { customerDate: '', customerTime: '', istDate: '', istTime: '' };

  const hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);

  const clientLocal = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, minutes);
  if (isNaN(clientLocal.getTime())) {
    return { customerDate: '', customerTime: '', istDate: '', istTime: '' };
  }

  const utcInstant = fromZonedTime(clientLocal, timezone);
  const istDateTime = toZonedTime(utcInstant, 'Asia/Kolkata');

  const customerDate = formatDate(clientLocal);
  const customerTime = formatTime(clientLocal);
  const istDate = formatDate(istDateTime);
  const istTime = formatTime(istDateTime);

  return { customerDate, customerTime, istDate, istTime };
}