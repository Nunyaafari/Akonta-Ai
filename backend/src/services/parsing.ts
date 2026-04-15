export interface ParsedTransaction {
  type: 'revenue' | 'expense';
  amount: number;
  category?: string;
  notes?: string;
  date?: Date;
}

const toNumber = (value: string): number => Number(value.replace(',', '.'));

export function parseWhatsAppEntry(message: string): ParsedTransaction[] {
  const text = message.trim().toLowerCase();
  const results: ParsedTransaction[] = [];

  const totalPattern = /(?:sold|made|earned|received)\s+(\d+(?:[.,]\d+)?).*?(?:spent|cost|paid)\s+(\d+(?:[.,]\d+)?)/;
  const totalMatch = text.match(totalPattern);

  if (totalMatch) {
    results.push({ type: 'revenue', amount: toNumber(totalMatch[1]), date: new Date() });
    results.push({ type: 'expense', amount: toNumber(totalMatch[2]), date: new Date() });
    return results;
  }

  const revenuePattern = /(?:made|sold|earned|received|income|revenue)\s+(\d+(?:[.,]\d+)?)/;
  const expensePattern = /(?:spent|expense|cost|paid|bought|buy)\s+(\d+(?:[.,]\d+)?)(?:\s+on\s+(.+))?/;

  const revenueMatch = text.match(revenuePattern);
  const expenseMatch = text.match(expensePattern);

  if (revenueMatch) {
    results.push({ type: 'revenue', amount: toNumber(revenueMatch[1]), date: new Date() });
  }

  if (expenseMatch) {
    const notes = expenseMatch[2]?.trim();
    results.push({
      type: 'expense',
      amount: toNumber(expenseMatch[1]),
      notes: notes || undefined,
      date: new Date()
    });
  }

  return results;
}
