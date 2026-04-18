import type { SummaryPayload, User } from '../types';

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
