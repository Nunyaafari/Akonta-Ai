import type { Prisma, PrismaClient, BusinessCategoryKind, LedgerAccountType } from '@prisma/client';

type DbLike = PrismaClient | Prisma.TransactionClient;

interface CategorySeed {
  kind: BusinessCategoryKind;
  name: string;
}

interface LedgerSeed {
  code: string;
  name: string;
  accountType: LedgerAccountType;
}

const normalizeLabel = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const baseSalesCategories = ['General sales'];
const baseExpenseCategories = ['Operating expenses'];

const bakerySalesCategories = ['Bread', 'Cakes', 'Pastries', 'Drinks', 'Custom orders'];
const bakeryExpenseCategories = ['Flour', 'Sugar', 'Eggs', 'Butter', 'Packaging', 'Gas', 'Rent', 'Wages', 'Transport'];

const salonSalesCategories = ['Braids', 'Haircut', 'Nails', 'Treatment', 'Wig installation', 'Product sales'];
const salonExpenseCategories = ['Hair products', 'Extensions', 'Shampoo', 'Rent', 'Wages', 'Electricity', 'Transport'];

const foodSalesCategories = ['Meals', 'Drinks', 'Takeaway', 'Custom orders'];
const foodExpenseCategories = ['Ingredients', 'Packaging', 'Gas', 'Rent', 'Wages', 'Transport'];

const defaultLedgerAccounts: LedgerSeed[] = [
  { code: '1000', name: 'Cash', accountType: 'asset' },
  { code: '1010', name: 'Mobile Money', accountType: 'asset' },
  { code: '1020', name: 'Bank', accountType: 'asset' },
  { code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
  { code: '1200', name: 'Inventory Supplies', accountType: 'asset' },
  { code: '2000', name: 'Accounts Payable', accountType: 'liability' },
  { code: '2100', name: 'Customer Deposits', accountType: 'liability' },
  { code: '2200', name: 'Loan Payable', accountType: 'liability' },
  { code: '3000', name: 'Owner Capital', accountType: 'equity' },
  { code: '3100', name: 'Owner Drawings', accountType: 'equity' },
  { code: '4000', name: 'Sales Revenue', accountType: 'income' },
  { code: '4010', name: 'Service Revenue', accountType: 'income' },
  { code: '5000', name: 'Cost of Sales', accountType: 'expense' },
  { code: '6000', name: 'Operating Expenses', accountType: 'expense' }
];

const resolveBusinessTypeGroup = (businessType?: string | null): 'bakery' | 'salon' | 'food' | 'general' => {
  const value = (businessType ?? '').toLowerCase();
  if (/(bakery|baker|pastr|cake)/.test(value)) return 'bakery';
  if (/(salon|barber|hair|beauty|spa|nails)/.test(value)) return 'salon';
  if (/(restaurant|food|kitchen|catering|chop|vendor)/.test(value)) return 'food';
  return 'general';
};

const buildDefaultCategories = (businessType?: string | null): CategorySeed[] => {
  const group = resolveBusinessTypeGroup(businessType);

  const sales = new Set<string>(baseSalesCategories);
  const expenses = new Set<string>(baseExpenseCategories);

  if (group === 'bakery') {
    bakerySalesCategories.forEach((item) => sales.add(item));
    bakeryExpenseCategories.forEach((item) => expenses.add(item));
  } else if (group === 'salon') {
    salonSalesCategories.forEach((item) => sales.add(item));
    salonExpenseCategories.forEach((item) => expenses.add(item));
  } else if (group === 'food') {
    foodSalesCategories.forEach((item) => sales.add(item));
    foodExpenseCategories.forEach((item) => expenses.add(item));
  }

  const rows: CategorySeed[] = [];
  Array.from(sales).forEach((name) => rows.push({ kind: 'sales', name }));
  Array.from(expenses).forEach((name) => rows.push({ kind: 'expense', name }));
  return rows;
};

export const seedDefaultBusinessCategories = async (
  tx: DbLike,
  params: { businessId: string; businessType?: string | null }
): Promise<void> => {
  const entries = buildDefaultCategories(params.businessType).map((entry) => ({
    businessId: params.businessId,
    kind: entry.kind,
    name: entry.name,
    normalizedName: normalizeLabel(entry.name),
    isDefault: true
  }));

  if (entries.length === 0) return;

  await tx.businessCategory.createMany({
    data: entries,
    skipDuplicates: true
  });
};

export const seedDefaultLedgerAccounts = async (
  tx: DbLike,
  params: { businessId: string }
): Promise<void> => {
  await tx.ledgerAccount.createMany({
    data: defaultLedgerAccounts.map((account) => ({
      businessId: params.businessId,
      code: account.code,
      name: account.name,
      normalizedName: normalizeLabel(account.name),
      accountType: account.accountType,
      isSystemDefault: true
    })),
    skipDuplicates: true
  });
};

export const bootstrapBusinessDefaults = async (
  tx: DbLike,
  params: { businessId: string; businessType?: string | null; includeLedger?: boolean }
): Promise<void> => {
  await seedDefaultBusinessCategories(tx, params);
  if (params.includeLedger !== false) {
    await seedDefaultLedgerAccounts(tx, { businessId: params.businessId });
  }
};
