import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Normalizes start and end date bounds for PocketBase SQLite datetime queries.
 * Expands 10-char 'YYYY-MM-DD' strings to full-day UTC timestamps ('00:00:00.000Z' and '23:59:59.999Z')
 * preventing lexicographical exclusion of records timestamped on the end date.
 */
export function normalizeDateBounds(startDate?: string, endDate?: string): { start?: string; end?: string } {
  const start = startDate && startDate.length === 10 ? `${startDate} 00:00:00.000Z` : startDate;
  const end = endDate && endDate.length === 10 ? `${endDate} 23:59:59.999Z` : endDate;
  return { start, end };
}

export function normalizeDateRange(startDate: string, endDate: string): { start: string; end: string } {
  const start = startDate && startDate.length === 10 ? `${startDate} 00:00:00.000Z` : startDate;
  const end = endDate && endDate.length === 10 ? `${endDate} 23:59:59.999Z` : endDate;
  return { start, end };
}
