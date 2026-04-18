import { formatStatementAmount } from './formatters';
import { escapeHtml, resolveBusinessName, resolveOwnerName, resolvePreparedOn } from './reportCommon';
import type { CashFlowStatementParams, StatementLine, ProfitLossStatementParams } from './reportTypes';

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
