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

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ParsedInterpretation {
  entries: ParsedTransaction[];
  parseConfidence: ParseConfidence;
  requiresReview: boolean;
  requiresConfirmation: boolean;
  followUpQuestion?: string;
  reason?: string;
  calculation?: {
    quantity: number;
    unitPrice: number;
    inferredTotal: number;
    explicitTotal?: number;
  };
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
  if (/(credit sale|sold on credit|credit|owes me|pay later)/i.test(text)) {
    return 'credit_sale';
  }
  if (/(momo|mobile money)/i.test(text)) {
    return 'momo_sale';
  }
  if (/(debtor|debt recovery|old debt|customer paid|cleared debt)/i.test(text)) {
    return 'debtor_recovery';
  }
  if (/(loan received|borrowed|loan inflow)/i.test(text)) {
    return 'loan_received';
  }
  if (/(capital introduced|owner added|added capital|money added to business|put into the business)/i.test(text)) {
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
  if (/(supplier credit|pay later to supplier)/i.test(text)) {
    return 'supplier_credit';
  }
  if (/(stock|inventory|supplier goods|restock|ingredients)/i.test(text)) {
    return 'stock_purchase';
  }
  return 'operating_expense';
};

const detectAmbiguity = (text: string): { question?: string; reason?: string } => {
  const value = text.trim().toLowerCase();

  if (/^paid\s+\d+(?:[.,]\d+)?$/.test(value)) {
    return {
      question: 'What was the payment for? (expense, loan repayment, supplier payment, or owner withdrawal)',
      reason: 'generic_paid_amount'
    };
  }

  if (/^received\s+\d+(?:[.,]\d+)?$/.test(value)) {
    return {
      question: 'Was this money from a sale, old debt payment, loan, or owner capital?',
      reason: 'generic_received_amount'
    };
  }

  if (/\bpaid supplier\b/.test(value) && !/\bpaid supplier\s+[a-z]/.test(value)) {
    return {
      question: 'Which supplier did you pay?',
      reason: 'missing_supplier'
    };
  }

  if (/\bcustomer owes me\b/.test(value) && !/\b([a-z]{2,})\s+owes me\b/.test(value)) {
    return {
      question: 'Which customer owes you this amount?',
      reason: 'missing_customer_name'
    };
  }

  if (/\bmoved money\b|\btransfer(?:red)? money\b/.test(value)) {
    if (!/\b(cash|bank|momo|mobile money)\b.*\b(cash|bank|momo|mobile money)\b/.test(value)) {
      return {
        question: 'From where to where? (cash, bank, or MoMo)',
        reason: 'missing_transfer_accounts'
      };
    }
  }

  if (/\bpaid loan\b/.test(value) && !/\b(interest|principal)\b/.test(value)) {
    return {
      question: 'Was this full loan principal, or did it include interest too?',
      reason: 'loan_split_unknown'
    };
  }

  if (/\bbought items\b|\bbought stuff\b/.test(value)) {
    return {
      question: 'Were these stock items, supplies, or operating expenses?',
      reason: 'generic_bought_items'
    };
  }

  return {};
};

const detectCalculationIntent = (text: string): ParsedInterpretation['calculation'] | undefined => {
  const value = text.toLowerCase();
  const calcMatch = value.match(/(\d+(?:[.,]\d+)?)(?:\s+\w+){0,4}\s*(?:x|\*|at)\s*(\d+(?:[.,]\d+)?)/i);
  if (!calcMatch) return undefined;

  const quantity = toNumber(calcMatch[1]);
  const unitPrice = toNumber(calcMatch[2]);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice <= 0) {
    return undefined;
  }

  const inferredTotal = Number((quantity * unitPrice).toFixed(2));
  const totalMatch = value.match(/\btotal\b[:\s]*?(\d+(?:[.,]\d+)?)/i);
  const explicitTotal = totalMatch ? toNumber(totalMatch[1]) : undefined;

  return {
    quantity,
    unitPrice,
    inferredTotal,
    explicitTotal: Number.isFinite(explicitTotal ?? NaN) ? explicitTotal : undefined
  };
};

export const interpretTransactionMessage = (message: string): ParsedInterpretation => {
  const text = message.trim();
  const lowered = text.toLowerCase();
  const ambiguity = detectAmbiguity(lowered);
  if (ambiguity.question) {
    return {
      entries: [],
      parseConfidence: 'low',
      requiresReview: true,
      requiresConfirmation: false,
      followUpQuestion: ambiguity.question,
      reason: ambiguity.reason
    };
  }

  const calculation = detectCalculationIntent(text);
  if (calculation && calculation.explicitTotal === undefined) {
    const inferredRevenueType = classifyRevenueEvent(lowered);
    const paymentHint = /(expense|paid|bought|spent)/i.test(lowered) ? 'expense' : 'revenue';
    const entry: ParsedTransaction = paymentHint === 'expense'
      ? {
        type: 'expense',
        eventType: classifyExpenseEvent(lowered),
        amount: calculation.inferredTotal,
        date: new Date()
      }
      : {
        type: 'revenue',
        eventType: inferredRevenueType,
        amount: calculation.inferredTotal,
        date: new Date()
      };

    return {
      entries: [entry],
      parseConfidence: 'medium',
      requiresReview: false,
      requiresConfirmation: true,
      reason: 'calculated_total_needs_confirmation',
      calculation
    };
  }

  const entries = parseWhatsAppEntry(text);
  if (entries.length === 0) {
    return {
      entries: [],
      parseConfidence: 'low',
      requiresReview: true,
      requiresConfirmation: false,
      reason: 'no_match'
    };
  }

  const hasClearIntentKeyword = /(sold|sale|sales|income|revenue|expense|spent|bought|credit|momo|cash|loan|capital)/i.test(lowered);
  const hasGenericOnly = /^(paid|received)\s+\d+(?:[.,]\d+)?(?:\s+\w+)?$/i.test(lowered);
  const parseConfidence: ParseConfidence = hasGenericOnly
    ? 'low'
    : hasClearIntentKeyword
      ? 'high'
      : 'medium';

  return {
    entries,
    parseConfidence,
    requiresReview: parseConfidence === 'low',
    requiresConfirmation: Boolean(calculation && calculation.explicitTotal === undefined),
    reason: hasGenericOnly ? 'generic_amount_phrase' : undefined,
    calculation
  };
};

export function parseWhatsAppEntry(message: string): ParsedTransaction[] {
  const text = message.trim().toLowerCase();
  const results: ParsedTransaction[] = [];

  const totalPattern = /(?:sold|made|earned|received|inflow)\s+(\d+(?:[.,]\d+)?).*?(?:spent|cost|paid|expense|outflow)\s+(\d+(?:[.,]\d+)?)/;
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

  const revenuePattern = /(?:made|sold|earned|received|income|revenue|inflow)[^\d]{0,40}(\d+(?:[.,]\d+)?)/;
  const revenueAmountFirstPattern = /(\d+(?:[.,]\d+)?).{0,40}(?:sale|sold|income|revenue|inflow|earned)/;
  const expensePattern = /(?:spent|expense|cost|paid|bought|buy|outflow)[^\d]{0,40}(\d+(?:[.,]\d+)?)(?:\s+on\s+(.+))?/;
  const expenseAmountFirstPattern = /(\d+(?:[.,]\d+)?).{0,40}(?:expense|spent|paid|bought|buy|outflow|cost)/;

  const revenueMatch = text.match(revenuePattern);
  const revenueAmountFirstMatch = text.match(revenueAmountFirstPattern);
  const expenseMatch = text.match(expensePattern);
  const expenseAmountFirstMatch = text.match(expenseAmountFirstPattern);

  if (revenueMatch || revenueAmountFirstMatch) {
    const rawAmount = revenueMatch?.[1] ?? revenueAmountFirstMatch?.[1];
    if (!rawAmount) return results;
    results.push({
      type: 'revenue',
      eventType: classifyRevenueEvent(text),
      amount: toNumber(rawAmount),
      date: new Date()
    });
  }

  if (expenseMatch || expenseAmountFirstMatch) {
    const notes = expenseMatch?.[2]?.trim();
    const rawAmount = expenseMatch?.[1] ?? expenseAmountFirstMatch?.[1];
    if (!rawAmount) return results;
    results.push({
      type: 'expense',
      eventType: classifyExpenseEvent(`${text} ${notes ?? ''}`),
      amount: toNumber(rawAmount),
      notes: notes || undefined,
      date: new Date()
    });
  }

  return results;
}
