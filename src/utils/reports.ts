import type { SummaryPayload, User } from '../types';
import { formatStatementAmount } from './formatters';

export type StatementLine = {
  label: string;
  amount: number;
};

export interface CashFlowLineItems {
  operatingInflowLines: StatementLine[];
  operatingOutflowLines: StatementLine[];
  financingInflowLines: StatementLine[];
  financingOutflowLines: StatementLine[];
}

interface BaseStatementParams {
  user: User | null;
  reportPeriodLabel: string;
  reportStatementSubtitle: string;
  activeCurrencyCode: string;
  statementPreparedBy: string;
  appCopyrightNotice: string;
}

export interface ProfitLossStatementParams extends BaseStatementParams {
  reportMode: 'monthly' | 'yearly';
  incomeLines: StatementLine[];
  directExpenseLines: StatementLine[];
  indirectExpenseLines: StatementLine[];
  activeReportSummary: SummaryPayload;
  netMargin: number;
  accountantReviewNote: string;
}

export interface ProfitLossPdfParams extends ProfitLossStatementParams {
  statementBusinessKey: string;
  statementPeriodKey: string;
}

export interface CashFlowStatementParams extends BaseStatementParams {
  cashFlowLineItems: CashFlowLineItems;
  activeReportSummary: SummaryPayload;
}

export interface CashFlowPdfParams extends CashFlowStatementParams {
  statementBusinessKey: string;
  statementPeriodKey: string;
}

const escapeCsvValue = (value: string): string => {
  const escaped = value.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const resolveBusinessName = (user: User | null): string => user?.businessName || 'Akonta AI Business';
const resolveOwnerName = (user: User | null): string => user?.name || 'Business Owner';
const resolvePreparedOn = (): string => new Date().toLocaleDateString('en-GH', { month: 'long', day: 'numeric', year: 'numeric' });

export const sanitizeFileName = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'report';
};

export const downloadCsvFile = (fileName: string, rows: string[][]): void => {
  const csvContent = rows.map((row) => row.map((cell) => escapeCsvValue(cell ?? '')).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
};

export const printStatementHtml = (statementHtml: string): void => {
  const blob = new Blob([statementHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';

  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }

    frameWindow.onafterprint = cleanup;
    frameWindow.focus();
    setTimeout(() => {
      frameWindow.print();
      setTimeout(cleanup, 1500);
    }, 80);
  };

  iframe.src = url;
  document.body.appendChild(iframe);
};

export const buildProfitLossStatementHtml = (params: ProfitLossStatementParams): string => {
  const {
    user,
    reportPeriodLabel,
    reportStatementSubtitle,
    activeCurrencyCode,
    statementPreparedBy,
    appCopyrightNotice,
    reportMode,
    incomeLines,
    directExpenseLines,
    indirectExpenseLines,
    activeReportSummary,
    netMargin,
    accountantReviewNote
  } = params;

  const businessName = resolveBusinessName(user);
  const ownerName = resolveOwnerName(user);
  const preparedOn = resolvePreparedOn();
  const statementAmount = (value: number) => formatStatementAmount(value, activeCurrencyCode);
  const incomeRows = incomeLines.length > 0
    ? incomeLines.map((line) => `
      <tr>
        <td>${escapeHtml(line.label)}</td>
        <td class="amount">${statementAmount(line.amount)}</td>
      </tr>
    `).join('')
    : `
      <tr>
        <td>No income recorded</td>
        <td class="amount">${statementAmount(0)}</td>
      </tr>
    `;
  const directExpenseRows = directExpenseLines.length > 0
    ? directExpenseLines.map((line) => `
      <tr class="expense-line">
        <td>${escapeHtml(line.label)}</td>
        <td class="amount">${statementAmount(line.amount)}</td>
      </tr>
    `).join('')
    : `
      <tr>
        <td>No direct expenses recorded</td>
        <td class="amount">${statementAmount(0)}</td>
      </tr>
    `;
  const indirectExpenseRows = indirectExpenseLines.length > 0
    ? indirectExpenseLines.map((line) => `
      <tr class="expense-line">
        <td>${escapeHtml(line.label)}</td>
        <td class="amount">${statementAmount(line.amount)}</td>
      </tr>
    `).join('')
    : `
      <tr>
        <td>No indirect expenses recorded</td>
        <td class="amount">${statementAmount(0)}</td>
      </tr>
    `;

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Profit and Loss Statement</title>
  <style>
    body { font-family: "Times New Roman", Georgia, serif; color: #111827; margin: 40px; }
    .sheet { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 30px; margin: 0; letter-spacing: 0.02em; text-transform: uppercase; }
    h2 { margin: 8px 0 0; font-size: 16px; font-weight: 500; color: #374151; }
    .meta { margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-size: 13px; }
    .meta-col { display: flex; flex-direction: column; gap: 10px; }
    .label { color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; display: block; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 14px; }
    thead th { text-align: left; border-bottom: 2px solid #111827; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: #4b5563; }
    tbody td { border-bottom: 1px solid #e5e7eb; padding: 8px 0; }
    .expense-line td:first-child { padding-left: 22px; }
    td.amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .section { margin-top: 22px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; font-weight: 700; }
    .totals tr td { font-weight: 700; border-bottom: 0; padding-top: 10px; }
    .net-profit { color: ${activeReportSummary.netProfit >= 0 ? '#047857' : '#b91c1c'}; }
    .review { margin-top: 20px; border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; background: #f9fafb; font-size: 13px; line-height: 1.5; }
    .review .label { margin-bottom: 6px; }
    .sign-grid { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .sign-card { border-top: 1px solid #111827; padding-top: 8px; }
    .sign-name { font-size: 13px; font-weight: 600; }
    .sign-role { font-size: 12px; color: #6b7280; margin-top: 3px; }
    .footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
    @page { size: A4; margin: 18mm; }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Profit and Loss Statement</h1>
    <h2>${escapeHtml(reportStatementSubtitle)}</h2>

    <div class="meta">
      <div class="meta-col">
        <div><span class="label">Business</span>${escapeHtml(businessName)}</div>
        <div><span class="label">Prepared For</span>${escapeHtml(ownerName)}</div>
        <div><span class="label">Prepared By</span>${escapeHtml(statementPreparedBy)}</div>
      </div>
      <div class="meta-col">
        <div><span class="label">Reporting Period</span>${escapeHtml(reportPeriodLabel)}</div>
        <div><span class="label">Prepared On</span>${escapeHtml(preparedOn)}</div>
        <div><span class="label">Statement Basis</span>${escapeHtml(reportMode === 'yearly' ? 'Annual Management Statement' : 'Monthly Management Statement')}</div>
      </div>
    </div>

    <div class="section">Income</div>
    <table>
      <thead>
        <tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr>
      </thead>
      <tbody>
        ${incomeRows}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Income</td><td class="amount">${statementAmount(activeReportSummary.totalRevenue)}</td></tr>
      </tbody>
    </table>

    <div class="section">Less: Direct Expenses</div>
    <table>
      <thead>
        <tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr>
      </thead>
      <tbody>
        ${directExpenseRows}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Direct Expenses</td><td class="amount">${statementAmount(activeReportSummary.directExpenses)}</td></tr>
      </tbody>
    </table>

    <table>
      <tbody class="totals">
        <tr><td>Gross Profit</td><td class="amount">${statementAmount(activeReportSummary.grossProfit)}</td></tr>
      </tbody>
    </table>

    <div class="section">Less: Indirect Business Expenses</div>
    <table>
      <thead>
        <tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr>
      </thead>
      <tbody>
        ${indirectExpenseRows}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Indirect Expenses</td><td class="amount">${statementAmount(activeReportSummary.indirectExpenses)}</td></tr>
      </tbody>
    </table>

    <table>
      <tbody class="totals">
        <tr><td>Total Business Expenses</td><td class="amount">${statementAmount(activeReportSummary.totalExpenses)}</td></tr>
        <tr class="net-profit"><td>Net Profit / (Loss)</td><td class="amount">${statementAmount(activeReportSummary.netProfit)}</td></tr>
        <tr><td>Net Margin</td><td class="amount">${activeReportSummary.totalRevenue > 0 ? `${netMargin.toFixed(1)}%` : 'N/A'}</td></tr>
      </tbody>
    </table>

    <div class="review">
      <span class="label">Accountant Review Note</span>
      ${escapeHtml(accountantReviewNote)}
    </div>

    <div class="sign-grid">
      <div class="sign-card">
        <div class="sign-name">${escapeHtml(statementPreparedBy)}</div>
        <div class="sign-role">Prepared by</div>
      </div>
      <div class="sign-card">
        <div class="sign-name">${escapeHtml(ownerName)}</div>
        <div class="sign-role">Reviewed/Approved by</div>
      </div>
    </div>

    <p class="footer">Generated by Akonta AI accounting workflow engine for ${escapeHtml(reportPeriodLabel)}. ${escapeHtml(appCopyrightNotice)}</p>
  </div>
</body>
</html>
  `.trim();
};

export const buildCashFlowStatementHtml = (params: CashFlowStatementParams): string => {
  const {
    user,
    reportPeriodLabel,
    reportStatementSubtitle,
    activeCurrencyCode,
    statementPreparedBy,
    appCopyrightNotice,
    cashFlowLineItems,
    activeReportSummary
  } = params;

  const businessName = resolveBusinessName(user);
  const ownerName = resolveOwnerName(user);
  const preparedOn = resolvePreparedOn();
  const statementAmount = (value: number) => formatStatementAmount(value, activeCurrencyCode);
  const renderRows = (
    rows: StatementLine[],
    fallbackLabel: string
  ) => {
    if (rows.length === 0) {
      return `
      <tr>
        <td>${escapeHtml(fallbackLabel)}</td>
        <td class="amount">${statementAmount(0)}</td>
      </tr>
      `;
    }
    return rows.map((line) => `
    <tr>
      <td>${escapeHtml(line.label)}</td>
      <td class="amount">${statementAmount(line.amount)}</td>
    </tr>
    `).join('');
  };

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cash Flow Statement</title>
  <style>
    body { font-family: "Times New Roman", Georgia, serif; color: #111827; margin: 40px; }
    .sheet { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 30px; margin: 0; letter-spacing: 0.02em; text-transform: uppercase; }
    h2 { margin: 8px 0 0; font-size: 16px; font-weight: 500; color: #374151; }
    .meta { margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-size: 13px; }
    .meta-col { display: flex; flex-direction: column; gap: 10px; }
    .label { color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; display: block; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
    thead th { text-align: left; border-bottom: 2px solid #111827; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: #4b5563; }
    tbody td { border-bottom: 1px solid #e5e7eb; padding: 8px 0; }
    td.amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .section { margin-top: 22px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; font-weight: 700; }
    .totals tr td { font-weight: 700; border-bottom: 0; padding-top: 10px; }
    .net-cash { color: ${activeReportSummary.cashFlow.netCashFlow >= 0 ? '#047857' : '#b91c1c'}; }
    .footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
    @page { size: A4; margin: 18mm; }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Cash Flow Statement</h1>
    <h2>${escapeHtml(reportStatementSubtitle)}</h2>

    <div class="meta">
      <div class="meta-col">
        <div><span class="label">Business</span>${escapeHtml(businessName)}</div>
        <div><span class="label">Prepared For</span>${escapeHtml(ownerName)}</div>
        <div><span class="label">Prepared By</span>${escapeHtml(statementPreparedBy)}</div>
      </div>
      <div class="meta-col">
        <div><span class="label">Reporting Period</span>${escapeHtml(reportPeriodLabel)}</div>
        <div><span class="label">Prepared On</span>${escapeHtml(preparedOn)}</div>
        <div><span class="label">Statement Basis</span>Cash Basis Management Statement</div>
      </div>
    </div>

    <div class="section">Operating Activities - Cash Inflows</div>
    <table>
      <thead><tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr></thead>
      <tbody>
        ${renderRows(cashFlowLineItems.operatingInflowLines, 'No operating cash inflows recorded')}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Operating Inflow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.operatingInflow)}</td></tr>
      </tbody>
    </table>

    <div class="section">Operating Activities - Cash Outflows</div>
    <table>
      <thead><tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr></thead>
      <tbody>
        ${renderRows(cashFlowLineItems.operatingOutflowLines, 'No operating cash outflows recorded')}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Operating Outflow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.operatingOutflow)}</td></tr>
        <tr><td>Net Cash from Operating Activities</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.operatingInflow - activeReportSummary.cashFlow.operatingOutflow)}</td></tr>
      </tbody>
    </table>

    <div class="section">Financing Activities - Cash Inflows</div>
    <table>
      <thead><tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr></thead>
      <tbody>
        ${renderRows(cashFlowLineItems.financingInflowLines, 'No financing inflows recorded')}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Financing Inflow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.financingInflow)}</td></tr>
      </tbody>
    </table>

    <div class="section">Financing Activities - Cash Outflows</div>
    <table>
      <thead><tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr></thead>
      <tbody>
        ${renderRows(cashFlowLineItems.financingOutflowLines, 'No financing outflows recorded')}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Financing Outflow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.financingOutflow)}</td></tr>
        <tr><td>Net Cash from Financing Activities</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.financingInflow - activeReportSummary.cashFlow.financingOutflow)}</td></tr>
      </tbody>
    </table>

    <table>
      <tbody class="totals">
        <tr><td>Total Cash Inflow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.totalCashInflow)}</td></tr>
        <tr><td>Total Cash Outflow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.totalCashOutflow)}</td></tr>
        <tr class="net-cash"><td>Net Cash Flow</td><td class="amount">${statementAmount(activeReportSummary.cashFlow.netCashFlow)}</td></tr>
      </tbody>
    </table>

    <p class="footer">Generated by Akonta AI accounting workflow engine for ${escapeHtml(reportPeriodLabel)}. ${escapeHtml(appCopyrightNotice)}</p>
  </div>
</body>
</html>
  `.trim();
};

export const generateProfitLossPdf = async (params: ProfitLossPdfParams): Promise<void> => {
  const {
    user,
    reportPeriodLabel,
    reportStatementSubtitle,
    activeCurrencyCode,
    reportMode,
    statementPreparedBy,
    appCopyrightNotice,
    incomeLines,
    directExpenseLines,
    indirectExpenseLines,
    activeReportSummary,
    netMargin,
    accountantReviewNote,
    statementBusinessKey,
    statementPeriodKey
  } = params;

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const statementAmount = (value: number) => formatStatementAmount(value, activeCurrencyCode);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const rightEdge = pageWidth - margin;
  let cursorY = margin;

  const ensureSpace = (heightNeeded: number) => {
    if (cursorY + heightNeeded <= pageHeight - margin) return;
    doc.addPage();
    cursorY = margin;
  };

  const drawRows = (rows: StatementLine[], labelIndent = 0) => {
    rows.forEach((row) => {
      const wrappedLabel = doc.splitTextToSize(row.label, rightEdge - (margin + labelIndent) - 130);
      const rowHeight = Math.max(14, wrappedLabel.length * 12);
      ensureSpace(rowHeight + 4);
      doc.setFont('times', 'normal');
      doc.setFontSize(10);
      doc.text(wrappedLabel, margin + labelIndent, cursorY);
      doc.text(statementAmount(row.amount), rightEdge, cursorY, { align: 'right' });
      cursorY += rowHeight;
    });
  };

  const renderSection = (
    title: string,
    rows: StatementLine[],
    emptyLabel: string,
    totalLabel: string,
    totalAmount: number,
    options?: { indentRows?: boolean }
  ) => {
    ensureSpace(54);
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), margin, cursorY);
    cursorY += 10;
    doc.line(margin, cursorY, rightEdge, cursorY);
    cursorY += 16;
    drawRows(rows.length > 0 ? rows : [{ label: emptyLabel, amount: 0 }], options?.indentRows ? 16 : 0);
    ensureSpace(22);
    doc.line(margin, cursorY, rightEdge, cursorY);
    cursorY += 14;
    doc.setFont('times', 'bold');
    doc.text(totalLabel, margin, cursorY);
    doc.text(statementAmount(totalAmount), rightEdge, cursorY, { align: 'right' });
    cursorY += 24;
  };

  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  doc.text('Profit and Loss Statement', margin, cursorY);
  cursorY += 26;

  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  doc.text(reportStatementSubtitle, margin, cursorY);
  cursorY += 24;

  const metadataLeft: Array<[string, string]> = [
    ['Business', resolveBusinessName(user)],
    ['Prepared For', resolveOwnerName(user)],
    ['Prepared By', statementPreparedBy]
  ];
  const metadataRight: Array<[string, string]> = [
    ['Reporting Period', reportPeriodLabel],
    ['Prepared On', resolvePreparedOn()],
    ['Statement Basis', reportMode === 'yearly' ? 'Annual Management Statement' : 'Monthly Management Statement']
  ];

  const metadataTop = cursorY;
  const columnGap = 28;
  const columnWidth = (rightEdge - margin - columnGap) / 2;
  const labelWidth = 92;
  const renderMetadataColumn = (entries: Array<[string, string]>, x: number, startY: number) => {
    let y = startY;
    entries.forEach(([label, value]) => {
      ensureSpace(20);
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text(`${label}:`, x, y);
      doc.setFont('times', 'normal');
      const wrapped = doc.splitTextToSize(value, columnWidth - labelWidth);
      doc.text(wrapped, x + labelWidth, y);
      y += Math.max(16, wrapped.length * 12);
    });
    return y;
  };

  const leftColumnY = renderMetadataColumn(metadataLeft, margin, metadataTop);
  const rightColumnY = renderMetadataColumn(metadataRight, margin + columnWidth + columnGap, metadataTop);
  cursorY = Math.max(leftColumnY, rightColumnY) + 8;

  renderSection('Income', incomeLines, 'No income recorded', 'Total Income', activeReportSummary.totalRevenue);
  renderSection(
    'Less: Direct Expenses',
    directExpenseLines,
    'No direct expenses recorded',
    'Total Direct Expenses',
    activeReportSummary.directExpenses,
    { indentRows: true }
  );

  ensureSpace(24);
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text('Gross Profit', margin, cursorY);
  doc.text(statementAmount(activeReportSummary.grossProfit), rightEdge, cursorY, { align: 'right' });
  cursorY += 20;

  renderSection(
    'Less: Indirect Business Expenses',
    indirectExpenseLines,
    'No indirect expenses recorded',
    'Total Indirect Expenses',
    activeReportSummary.indirectExpenses,
    { indentRows: true }
  );

  ensureSpace(30);
  doc.line(margin, cursorY, rightEdge, cursorY);
  cursorY += 14;
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text('Total Business Expenses', margin, cursorY);
  doc.text(statementAmount(activeReportSummary.totalExpenses), rightEdge, cursorY, { align: 'right' });
  cursorY += 18;
  doc.text('Net Profit / (Loss)', margin, cursorY);
  doc.text(statementAmount(activeReportSummary.netProfit), rightEdge, cursorY, { align: 'right' });
  cursorY += 16;
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  doc.text(`Net Margin: ${activeReportSummary.totalRevenue > 0 ? `${netMargin.toFixed(1)}%` : 'N/A'}`, margin, cursorY);
  cursorY += 24;

  ensureSpace(58);
  doc.setFont('times', 'bold');
  doc.setFontSize(10);
  doc.text('Accountant Review Note', margin, cursorY);
  cursorY += 14;
  doc.setFont('times', 'normal');
  const reviewLines = doc.splitTextToSize(accountantReviewNote, rightEdge - margin);
  doc.text(reviewLines, margin, cursorY);
  cursorY += Math.max(20, reviewLines.length * 12 + 10);

  ensureSpace(22);
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  const footerText = `Generated by Akonta AI accounting workflow engine for ${reportPeriodLabel}. ${appCopyrightNotice}`;
  const footerLines = doc.splitTextToSize(footerText, rightEdge - margin);
  doc.text(footerLines, margin, cursorY);
  doc.setTextColor(17, 24, 39);

  doc.save(`${statementBusinessKey}-profit-loss-${statementPeriodKey}.pdf`);
};

export const generateCashFlowPdf = async (params: CashFlowPdfParams): Promise<void> => {
  const {
    user,
    reportPeriodLabel,
    reportStatementSubtitle,
    activeCurrencyCode,
    statementPreparedBy,
    appCopyrightNotice,
    cashFlowLineItems,
    activeReportSummary,
    statementBusinessKey,
    statementPeriodKey
  } = params;

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const statementAmount = (value: number) => formatStatementAmount(value, activeCurrencyCode);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const rightEdge = pageWidth - margin;
  let cursorY = margin;

  const ensureSpace = (heightNeeded: number) => {
    if (cursorY + heightNeeded <= pageHeight - margin) return;
    doc.addPage();
    cursorY = margin;
  };

  const drawRows = (rows: StatementLine[], emptyLabel: string) => {
    const renderRows = rows.length > 0 ? rows : [{ label: emptyLabel, amount: 0 }];
    renderRows.forEach((row) => {
      const wrappedLabel = doc.splitTextToSize(row.label, rightEdge - margin - 130);
      const rowHeight = Math.max(14, wrappedLabel.length * 12);
      ensureSpace(rowHeight + 4);
      doc.setFont('times', 'normal');
      doc.setFontSize(10);
      doc.text(wrappedLabel, margin, cursorY);
      doc.text(statementAmount(row.amount), rightEdge, cursorY, { align: 'right' });
      cursorY += rowHeight;
    });
  };

  const renderSection = (
    title: string,
    rows: StatementLine[],
    emptyLabel: string,
    totalLabel: string,
    totalAmount: number
  ) => {
    ensureSpace(56);
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), margin, cursorY);
    cursorY += 10;
    doc.line(margin, cursorY, rightEdge, cursorY);
    cursorY += 16;
    drawRows(rows, emptyLabel);
    ensureSpace(20);
    doc.line(margin, cursorY, rightEdge, cursorY);
    cursorY += 14;
    doc.setFont('times', 'bold');
    doc.text(totalLabel, margin, cursorY);
    doc.text(statementAmount(totalAmount), rightEdge, cursorY, { align: 'right' });
    cursorY += 22;
  };

  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  doc.text('Cash Flow Statement', margin, cursorY);
  cursorY += 26;

  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  doc.text(reportStatementSubtitle, margin, cursorY);
  cursorY += 24;

  const metadataLeft: Array<[string, string]> = [
    ['Business', resolveBusinessName(user)],
    ['Prepared For', resolveOwnerName(user)],
    ['Prepared By', statementPreparedBy]
  ];
  const metadataRight: Array<[string, string]> = [
    ['Reporting Period', reportPeriodLabel],
    ['Prepared On', resolvePreparedOn()],
    ['Statement Basis', 'Cash Basis Management Statement']
  ];

  const metadataTop = cursorY;
  const columnGap = 28;
  const columnWidth = (rightEdge - margin - columnGap) / 2;
  const labelWidth = 92;
  const renderMetadataColumn = (entries: Array<[string, string]>, x: number, startY: number) => {
    let y = startY;
    entries.forEach(([label, value]) => {
      ensureSpace(20);
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text(`${label}:`, x, y);
      doc.setFont('times', 'normal');
      const wrapped = doc.splitTextToSize(value, columnWidth - labelWidth);
      doc.text(wrapped, x + labelWidth, y);
      y += Math.max(16, wrapped.length * 12);
    });
    return y;
  };

  const leftColumnY = renderMetadataColumn(metadataLeft, margin, metadataTop);
  const rightColumnY = renderMetadataColumn(metadataRight, margin + columnWidth + columnGap, metadataTop);
  cursorY = Math.max(leftColumnY, rightColumnY) + 8;

  renderSection(
    'Operating Activities - Cash Inflows',
    cashFlowLineItems.operatingInflowLines,
    'No operating cash inflows recorded',
    'Total Operating Inflow',
    activeReportSummary.cashFlow.operatingInflow
  );
  renderSection(
    'Operating Activities - Cash Outflows',
    cashFlowLineItems.operatingOutflowLines,
    'No operating cash outflows recorded',
    'Total Operating Outflow',
    activeReportSummary.cashFlow.operatingOutflow
  );
  ensureSpace(20);
  doc.setFont('times', 'bold');
  doc.text('Net Cash from Operating Activities', margin, cursorY);
  doc.text(
    statementAmount(activeReportSummary.cashFlow.operatingInflow - activeReportSummary.cashFlow.operatingOutflow),
    rightEdge,
    cursorY,
    { align: 'right' }
  );
  cursorY += 24;

  renderSection(
    'Financing Activities - Cash Inflows',
    cashFlowLineItems.financingInflowLines,
    'No financing inflows recorded',
    'Total Financing Inflow',
    activeReportSummary.cashFlow.financingInflow
  );
  renderSection(
    'Financing Activities - Cash Outflows',
    cashFlowLineItems.financingOutflowLines,
    'No financing outflows recorded',
    'Total Financing Outflow',
    activeReportSummary.cashFlow.financingOutflow
  );
  ensureSpace(20);
  doc.setFont('times', 'bold');
  doc.text('Net Cash from Financing Activities', margin, cursorY);
  doc.text(
    statementAmount(activeReportSummary.cashFlow.financingInflow - activeReportSummary.cashFlow.financingOutflow),
    rightEdge,
    cursorY,
    { align: 'right' }
  );
  cursorY += 24;

  ensureSpace(40);
  doc.line(margin, cursorY, rightEdge, cursorY);
  cursorY += 14;
  doc.setFont('times', 'bold');
  doc.text('Total Cash Inflow', margin, cursorY);
  doc.text(statementAmount(activeReportSummary.cashFlow.totalCashInflow), rightEdge, cursorY, { align: 'right' });
  cursorY += 16;
  doc.text('Total Cash Outflow', margin, cursorY);
  doc.text(statementAmount(activeReportSummary.cashFlow.totalCashOutflow), rightEdge, cursorY, { align: 'right' });
  cursorY += 18;
  doc.setTextColor(
    activeReportSummary.cashFlow.netCashFlow >= 0 ? 4 : 185,
    activeReportSummary.cashFlow.netCashFlow >= 0 ? 120 : 28,
    activeReportSummary.cashFlow.netCashFlow >= 0 ? 87 : 28
  );
  doc.text('Net Cash Flow', margin, cursorY);
  doc.text(statementAmount(activeReportSummary.cashFlow.netCashFlow), rightEdge, cursorY, { align: 'right' });
  doc.setTextColor(17, 24, 39);
  cursorY += 24;

  ensureSpace(22);
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  const footerText = `Generated by Akonta AI accounting workflow engine for ${reportPeriodLabel}. ${appCopyrightNotice}`;
  const footerLines = doc.splitTextToSize(footerText, rightEdge - margin);
  doc.text(footerLines, margin, cursorY);
  doc.setTextColor(17, 24, 39);

  doc.save(`${statementBusinessKey}-cash-flow-${statementPeriodKey}.pdf`);
};

export interface ProfitLossCsvRowsParams {
  reportPeriodLabel: string;
  businessName: string;
  reportStatementSubtitle: string;
  activeCurrencyCode: string;
  activeReportSummary: SummaryPayload;
  incomeLines: StatementLine[];
  directExpenseLines: StatementLine[];
  indirectExpenseLines: StatementLine[];
  netMargin: number;
}

export const buildProfitLossCsvRows = (params: ProfitLossCsvRowsParams): string[][] => {
  const {
    reportPeriodLabel,
    businessName,
    reportStatementSubtitle,
    activeCurrencyCode,
    activeReportSummary,
    incomeLines,
    directExpenseLines,
    indirectExpenseLines,
    netMargin
  } = params;

  const amount = (value: number) => value.toFixed(2);
  const rows: string[][] = [
    ['Report', 'Period', 'Business', 'Section', 'Line Item', 'Amount', 'Currency'],
    ['Profit & Loss Statement', reportPeriodLabel, businessName, 'Metadata', 'Statement subtitle', reportStatementSubtitle, ''],
    ['Profit & Loss Statement', reportPeriodLabel, businessName, 'Income', 'Total Income', amount(activeReportSummary.totalRevenue), activeCurrencyCode]
  ];

  (incomeLines.length > 0 ? incomeLines : [{ label: 'No income recorded', amount: 0 }]).forEach((line) => {
    rows.push([
      'Profit & Loss Statement',
      reportPeriodLabel,
      businessName,
      'Income',
      line.label,
      amount(line.amount),
      activeCurrencyCode
    ]);
  });

  rows.push(['Profit & Loss Statement', reportPeriodLabel, businessName, 'Direct Expenses', 'Total Direct Expenses', amount(activeReportSummary.directExpenses), activeCurrencyCode]);
  (directExpenseLines.length > 0 ? directExpenseLines : [{ label: 'No direct expenses recorded', amount: 0 }]).forEach((line) => {
    rows.push([
      'Profit & Loss Statement',
      reportPeriodLabel,
      businessName,
      'Direct Expenses',
      line.label,
      amount(line.amount),
      activeCurrencyCode
    ]);
  });

  rows.push(['Profit & Loss Statement', reportPeriodLabel, businessName, 'Gross Profit', 'Gross Profit', amount(activeReportSummary.grossProfit), activeCurrencyCode]);
  rows.push(['Profit & Loss Statement', reportPeriodLabel, businessName, 'Indirect Expenses', 'Total Indirect Expenses', amount(activeReportSummary.indirectExpenses), activeCurrencyCode]);
  (indirectExpenseLines.length > 0 ? indirectExpenseLines : [{ label: 'No indirect expenses recorded', amount: 0 }]).forEach((line) => {
    rows.push([
      'Profit & Loss Statement',
      reportPeriodLabel,
      businessName,
      'Indirect Expenses',
      line.label,
      amount(line.amount),
      activeCurrencyCode
    ]);
  });

  rows.push(['Profit & Loss Statement', reportPeriodLabel, businessName, 'Summary', 'Total Business Expenses', amount(activeReportSummary.totalExpenses), activeCurrencyCode]);
  rows.push(['Profit & Loss Statement', reportPeriodLabel, businessName, 'Summary', 'Net Profit / (Loss)', amount(activeReportSummary.netProfit), activeCurrencyCode]);
  rows.push(['Profit & Loss Statement', reportPeriodLabel, businessName, 'Summary', 'Net Margin (%)', activeReportSummary.totalRevenue > 0 ? netMargin.toFixed(1) : 'N/A', '']);

  return rows;
};

export interface CashFlowCsvRowsParams {
  reportPeriodLabel: string;
  businessName: string;
  reportStatementSubtitle: string;
  activeCurrencyCode: string;
  activeReportSummary: SummaryPayload;
  cashFlowLineItems: CashFlowLineItems;
}

export const buildCashFlowCsvRows = (params: CashFlowCsvRowsParams): string[][] => {
  const {
    reportPeriodLabel,
    businessName,
    reportStatementSubtitle,
    activeCurrencyCode,
    activeReportSummary,
    cashFlowLineItems
  } = params;

  const amount = (value: number) => value.toFixed(2);
  const rows: string[][] = [
    ['Report', 'Period', 'Business', 'Section', 'Line Item', 'Amount', 'Currency'],
    ['Cash Flow Statement', reportPeriodLabel, businessName, 'Metadata', 'Statement subtitle', reportStatementSubtitle, '']
  ];

  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Operating Inflow', 'Total Operating Inflow', amount(activeReportSummary.cashFlow.operatingInflow), activeCurrencyCode]);
  (cashFlowLineItems.operatingInflowLines.length > 0 ? cashFlowLineItems.operatingInflowLines : [{ label: 'No operating cash inflows recorded', amount: 0 }]).forEach((line) => {
    rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Operating Inflow', line.label, amount(line.amount), activeCurrencyCode]);
  });

  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Operating Outflow', 'Total Operating Outflow', amount(activeReportSummary.cashFlow.operatingOutflow), activeCurrencyCode]);
  (cashFlowLineItems.operatingOutflowLines.length > 0 ? cashFlowLineItems.operatingOutflowLines : [{ label: 'No operating cash outflows recorded', amount: 0 }]).forEach((line) => {
    rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Operating Outflow', line.label, amount(line.amount), activeCurrencyCode]);
  });
  rows.push([
    'Cash Flow Statement',
    reportPeriodLabel,
    businessName,
    'Operating',
    'Net Cash from Operating Activities',
    amount(activeReportSummary.cashFlow.operatingInflow - activeReportSummary.cashFlow.operatingOutflow),
    activeCurrencyCode
  ]);

  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Financing Inflow', 'Total Financing Inflow', amount(activeReportSummary.cashFlow.financingInflow), activeCurrencyCode]);
  (cashFlowLineItems.financingInflowLines.length > 0 ? cashFlowLineItems.financingInflowLines : [{ label: 'No financing inflows recorded', amount: 0 }]).forEach((line) => {
    rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Financing Inflow', line.label, amount(line.amount), activeCurrencyCode]);
  });

  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Financing Outflow', 'Total Financing Outflow', amount(activeReportSummary.cashFlow.financingOutflow), activeCurrencyCode]);
  (cashFlowLineItems.financingOutflowLines.length > 0 ? cashFlowLineItems.financingOutflowLines : [{ label: 'No financing outflows recorded', amount: 0 }]).forEach((line) => {
    rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Financing Outflow', line.label, amount(line.amount), activeCurrencyCode]);
  });
  rows.push([
    'Cash Flow Statement',
    reportPeriodLabel,
    businessName,
    'Financing',
    'Net Cash from Financing Activities',
    amount(activeReportSummary.cashFlow.financingInflow - activeReportSummary.cashFlow.financingOutflow),
    activeCurrencyCode
  ]);

  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Summary', 'Total Cash Inflow', amount(activeReportSummary.cashFlow.totalCashInflow), activeCurrencyCode]);
  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Summary', 'Total Cash Outflow', amount(activeReportSummary.cashFlow.totalCashOutflow), activeCurrencyCode]);
  rows.push(['Cash Flow Statement', reportPeriodLabel, businessName, 'Summary', 'Net Cash Flow', amount(activeReportSummary.cashFlow.netCashFlow), activeCurrencyCode]);

  return rows;
};
