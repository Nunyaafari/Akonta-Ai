export interface ParsedTransaction {
  type: 'revenue' | 'expense';
  eventType?:
    | 'cash_sale'
    | 'momo_sale'
    | 'credit_sale'
    | 'debtor_recovery'
    | 'stock_purchase'
    | 'operating_expense'
    | 'owner_withdrawal'
    | 'loan_received'
    | 'loan_repayment'
    | 'supplier_credit'
    | 'capital_introduced'
    | 'other';
  amount: number;
  category?: string;
  notes?: string;
  date?: Date;
}

const toNumber = (value: string): number => {
  const raw = value.trim();

  if (raw.includes('.') && raw.includes(',')) {
    return Number(raw.replace(/,/g, ''));
  }

  if (raw.includes(',')) {
    const [whole, fraction] = raw.split(',');
    if (fraction !== undefined && fraction.length > 0 && fraction.length <= 2) {
      return Number(`${whole}.${fraction}`);
    }
    return Number(raw.replace(/,/g, ''));
  }

  return Number(raw);
};

const classifyRevenueEvent = (text: string): ParsedTransaction['eventType'] => {
  if (/(credit sale|sold on credit|credit)/i.test(text)) {
    return 'credit_sale';
  }
  if (/(momo|mobile money|mobile transfer|transfer)/i.test(text)) {
    return 'momo_sale';
  }
  if (/(debtor|debt recovery|old debt|customer paid)/i.test(text)) {
    return 'debtor_recovery';
  }
  if (/(loan received|borrowed|loan inflow)/i.test(text)) {
    return 'loan_received';
  }
  if (/(capital introduced|owner added|added capital|money added to business)/i.test(text)) {
    return 'capital_introduced';
  }
  return 'cash_sale';
};

const classifyExpenseEvent = (text: string): ParsedTransaction['eventType'] => {
  if (/(loan repayment|repaid loan|paid loan)/i.test(text)) {
    return 'loan_repayment';
  }
  if (/(personal|owner|family|home|private|withdraw)/i.test(text)) {
    return 'owner_withdrawal';
  }
  if (/(stock|inventory|supplier goods|restock)/i.test(text)) {
    return 'stock_purchase';
  }
  if (/(supplier credit|pay later to supplier)/i.test(text)) {
    return 'supplier_credit';
  }
  return 'operating_expense';
};

export function parseWhatsAppEntry(message: string): ParsedTransaction[] {
  const text = message.trim().toLowerCase();
  const results: ParsedTransaction[] = [];

  const totalPattern = /(?:sold|made|earned|received)\s+(\d+(?:[.,]\d+)?).*?(?:spent|cost|paid)\s+(\d+(?:[.,]\d+)?)/;
  const totalMatch = text.match(totalPattern);

  if (totalMatch) {
    results.push({
      type: 'revenue',
      eventType: classifyRevenueEvent(text),
      amount: toNumber(totalMatch[1]),
      date: new Date()
    });
    results.push({
      type: 'expense',
      eventType: classifyExpenseEvent(text),
      amount: toNumber(totalMatch[2]),
      date: new Date()
    });
    return results;
  }

  const loanReceivedPattern = /(?:loan(?:\s+received)?|borrowed)\s+(\d+(?:[.,]\d+)?)/;
  const capitalPattern = /(?:capital(?:\s+introduced)?|owner added|added(?:\s+to business)?)\s+(\d+(?:[.,]\d+)?)/;
  const loanRepaymentPattern = /(?:loan\s+repayment|repaid(?:\s+loan)?|paid\s+loan)\s+(\d+(?:[.,]\d+)?)/;
  const debtorRecoveryPattern = /(?:debt(?:or)?\s+(?:recovery|recovered)|customer paid|old debt)\s+(\d+(?:[.,]\d+)?)/;

  const loanReceivedMatch = text.match(loanReceivedPattern);
  if (loanReceivedMatch) {
    results.push({
      type: 'revenue',
      eventType: 'loan_received',
      amount: toNumber(loanReceivedMatch[1]),
      date: new Date()
    });
  }

  const capitalMatch = text.match(capitalPattern);
  if (capitalMatch) {
    results.push({
      type: 'revenue',
      eventType: 'capital_introduced',
      amount: toNumber(capitalMatch[1]),
      date: new Date()
    });
  }

  const loanRepaymentMatch = text.match(loanRepaymentPattern);
  if (loanRepaymentMatch) {
    results.push({
      type: 'expense',
      eventType: 'loan_repayment',
      amount: toNumber(loanRepaymentMatch[1]),
      date: new Date()
    });
  }

  const debtorRecoveryMatch = text.match(debtorRecoveryPattern);
  if (debtorRecoveryMatch) {
    results.push({
      type: 'revenue',
      eventType: 'debtor_recovery',
      amount: toNumber(debtorRecoveryMatch[1]),
      date: new Date()
    });
  }

  if (results.length > 0) {
    return results;
  }

  const revenuePattern = /(?:made|sold|earned|received|income|revenue)\s+(\d+(?:[.,]\d+)?)/;
  const expensePattern = /(?:spent|expense|cost|paid|bought|buy)\s+(\d+(?:[.,]\d+)?)(?:\s+on\s+(.+))?/;

  const revenueMatch = text.match(revenuePattern);
  const expenseMatch = text.match(expensePattern);

  if (revenueMatch) {
    results.push({
      type: 'revenue',
      eventType: classifyRevenueEvent(text),
      amount: toNumber(revenueMatch[1]),
      date: new Date()
    });
  }

  if (expenseMatch) {
    const notes = expenseMatch[2]?.trim();
    results.push({
      type: 'expense',
      eventType: classifyExpenseEvent(`${text} ${notes ?? ''}`),
      amount: toNumber(expenseMatch[1]),
      notes: notes || undefined,
      date: new Date()
    });
  }

  return results;
}
