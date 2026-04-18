import type { SummaryPayload } from '../types';
import type { CashFlowLineItems, StatementLine } from './reportTypes';

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
