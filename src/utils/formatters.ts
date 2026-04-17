export const formatCurrencyValue = (amount: number, currencyCode = 'GHS') => {
  try {
    return new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
};

export const formatStatementAmount = (amount: number, currencyCode = 'GHS') => {
  const code = (currencyCode || 'GHS').toUpperCase();
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${code} ${safeAmount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

export const formatDate = (date: Date | string) => {
  return new Date(date).toLocaleDateString('en-GH', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });
};

export const formatTime = (date: Date | string) => {
  return new Date(date).toLocaleTimeString('en-GH', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
};

export const parseDateValue = (value?: Date | string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};