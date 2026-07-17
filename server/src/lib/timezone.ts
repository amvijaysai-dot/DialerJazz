import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export function convertClientScheduleToIST(
  date: string,
  time: string,
  timezone: string
): { customerDate: string; customerTime: string; istDate: string; istTime: string } {
  if (!date || !time || !timezone) {
    return { customerDate: '', customerTime: '', istDate: '', istTime: '' };
  }

  // Validate ISO date format: YYYY-MM-DD
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) return { customerDate: '', customerTime: '', istDate: '', istTime: '' };

  const [, year, month, day] = dateMatch;

  // Validate time format: HH:MM (24-hour)
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!timeMatch) return { customerDate: '', customerTime: '', istDate: '', istTime: '' };

  const hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);

  // Create a date representing client's local datetime
  const clientLocal = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, minutes);
  if (isNaN(clientLocal.getTime())) {
    return { customerDate: '', customerTime: '', istDate: '', istTime: '' };
  }

  // Convert to IST
  const utcInstant = fromZonedTime(clientLocal, timezone);
  const istDateTime = toZonedTime(utcInstant, 'Asia/Kolkata');

  // Format customer date/time (DD-MMM-YYYY and hh:mm AM/PM)
  const customerDate = formatDateForDisplay(clientLocal);
  const customerTime = formatTimeForDisplay(clientLocal);

  // Format IST date/time
  const istDate = formatDateForDisplay(istDateTime);
  const istTime = formatTimeForDisplay(istDateTime);

  return { customerDate, customerTime, istDate, istTime };
}

function formatDateForDisplay(date: Date): string {
  if (!date || isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatTimeForDisplay(date: Date): string {
  if (!date || isNaN(date.getTime())) return '';
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours || 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${period}`;
}