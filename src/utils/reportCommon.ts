import type { User } from '../types';

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const resolveBusinessName = (user: User | null): string => user?.businessName || 'Akonta AI Business';
export const resolveOwnerName = (user: User | null): string => user?.name || 'Business Owner';
export const resolvePreparedOn = (): string => new Date().toLocaleDateString('en-GH', { month: 'long', day: 'numeric', year: 'numeric' });
