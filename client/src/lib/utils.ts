import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalize a phone number to E.164 format (e.g., +14076602212)
 * Handles various input formats: 4076602212, (407) 660-2212, 1-407-660-2212, +14076602212
 */
export function toE164(number: string): string {
  if (!number) return '';
  
  // Remove all non-digit characters except +
  let cleaned = number.replace(/[^\d+]/g, '');
  
  // If already has +, assume it's already in E.164
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // Remove leading 1 if present (US country code)
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }
  
  // If 10 digits, assume US number and add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If 11 digits and starts with 1, add +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  // Otherwise add + prefix
  return `+${cleaned}`;
}

/**
 * Validate if a phone number is in valid E.164 format
 */
export function isValidE164(number: string): boolean {
  if (!number) return false;
  // E.164 format: + followed by 10-15 digits
  return /^\+[1-9]\d{9,14}$/.test(number);
}
