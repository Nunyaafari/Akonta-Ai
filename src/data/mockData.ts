import { Transaction, WeeklySummary, MonthlySummary, PremiumInsight, ChatMessage } from '../types';

export const mockTransactions: Transaction[] = [
  { id: '1', userId: 'user1', type: 'revenue', amount: 850, date: new Date('2024-01-15'), notes: 'Morning sales', category: 'Sales', createdAt: new Date('2024-01-15') },
  { id: '2', userId: 'user1', type: 'expense', amount: 200, date: new Date('2024-01-15'), notes: 'Stock purchase', category: 'Inventory', createdAt: new Date('2024-01-15') },
  { id: '3', userId: 'user1', type: 'revenue', amount: 1200, date: new Date('2024-01-14'), notes: 'Good day!', category: 'Sales', createdAt: new Date('2024-01-14') },
  { id: '4', userId: 'user1', type: 'expense', amount: 150, date: new Date('2024-01-14'), notes: 'Transport', category: 'Transport', createdAt: new Date('2024-01-14') },
  { id: '5', userId: 'user1', type: 'revenue', amount: 600, date: new Date('2024-01-13'), notes: 'Slow day', category: 'Sales', createdAt: new Date('2024-01-13') },
  { id: '6', userId: 'user1', type: 'expense', amount: 80, date: new Date('2024-01-13'), notes: 'Lunch', category: 'Food', createdAt: new Date('2024-01-13') },
  { id: '7', userId: 'user1', type: 'revenue', amount: 950, date: new Date('2024-01-12'), notes: 'Market day', category: 'Sales', createdAt: new Date('2024-01-12') },
  { id: '8', userId: 'user1', type: 'expense', amount: 300, date: new Date('2024-01-12'), notes: 'New stock', category: 'Inventory', createdAt: new Date('2024-01-12') },
  { id: '9', userId: 'user1', type: 'revenue', amount: 1100, date: new Date('2024-01-11'), notes: 'Weekend rush', category: 'Sales', createdAt: new Date('2024-01-11') },
  { id: '10', userId: 'user1', type: 'revenue', amount: 750, date: new Date('2024-01-10'), notes: '', category: 'Sales', createdAt: new Date('2024-01-10') },
  { id: '11', userId: 'user1', type: 'expense', amount: 100, date: new Date('2024-01-10'), notes: 'Airtime', category: 'Utilities', createdAt: new Date('2024-01-10') },
  { id: '12', userId: 'user1', type: 'revenue', amount: 900, date: new Date('2024-01-09'), notes: '', category: 'Sales', createdAt: new Date('2024-01-09') },
  { id: '13', userId: 'user1', type: 'expense', amount: 250, date: new Date('2024-01-09'), notes: 'Rent contribution', category: 'Rent', createdAt: new Date('2024-01-09') },
];

export const currentWeekSummary: WeeklySummary = {
  weekNumber: 3,
  startDate: new Date('2024-01-15'),
  endDate: new Date('2024-01-21'),
  totalRevenue: 5350,
  totalExpenses: 1080,
  profit: 4270,
  transactionCount: 13,
  dailyBreakdown: [
    { date: new Date('2024-01-15'), revenue: 850, expenses: 200 },
    { date: new Date('2024-01-14'), revenue: 1200, expenses: 150 },
    { date: new Date('2024-01-13'), revenue: 600, expenses: 80 },
    { date: new Date('2024-01-12'), revenue: 950, expenses: 300 },
    { date: new Date('2024-01-11'), revenue: 1100, expenses: 0 },
    { date: new Date('2024-01-10'), revenue: 750, expenses: 100 },
    { date: new Date('2024-01-09'), revenue: 900, expenses: 250 },
  ]
};

export const currentMonthSummary: MonthlySummary = {
  month: 1,
  year: 2024,
  totalRevenue: 21500,
  totalExpenses: 4850,
  profit: 16650,
  transactionCount: 52,
  weeklyBreakdown: [],
  topExpenseCategories: [
    { category: 'Inventory', amount: 1850 },
    { category: 'Transport', amount: 1200 },
    { category: 'Food', amount: 800 },
    { category: 'Rent', amount: 500 },
    { category: 'Utilities', amount: 500 },
  ]
};

export const premiumInsights: PremiumInsight[] = [
  {
    id: '1',
    type: 'warning',
    title: 'Cash Flow Alert',
    message: 'Based on your current spending rate, you may run low on cash in 12 days. Consider reducing stock purchases.',
    icon: '⚠️'
  },
  {
    id: '2',
    type: 'recommendation',
    title: 'Stock Optimization',
    message: 'You spent 38% of your expenses on inventory this month. Track your stock-to-sales ratio for better insights.',
    icon: '📊'
  },
  {
    id: '3',
    type: 'insight',
    title: 'Revenue Trend',
    message: 'Your revenue this week is 15% higher than last week. Keep up the great work! 🎉',
    icon: '📈'
  },
  {
    id: '4',
    type: 'recommendation',
    title: 'Expense Pattern',
    message: 'Transport costs are highest on market days. Consider batching trips to save money.',
    icon: '💡'
  }
];

export const chatMessages: ChatMessage[] = [
  { id: '1', type: 'bot', content: "Good morning, Kofi! ☀️ Ready to log yesterday's numbers?", timestamp: new Date('2024-01-16T08:00:00') },
  { id: '2', type: 'user', content: 'I made 500 cedis', timestamp: new Date('2024-01-16T08:05:00'), parsed: { revenue: 500 } },
  { id: '3', type: 'bot', content: "Great! I recorded **GHS 500** as revenue for today. Did you have any expenses? 💰", timestamp: new Date('2024-01-16T08:05:30') },
  { id: '4', type: 'user', content: 'Spent 100 on transport', timestamp: new Date('2024-01-16T08:06:00'), parsed: { expense: 100, notes: 'transport' } },
  { id: '5', type: 'bot', content: "Got it! I've saved:\n\n✅ Revenue: GHS 500\n✅ Expense: GHS 100 (transport)\n\n**Today's profit: GHS 400** 🎉", timestamp: new Date('2024-01-16T08:06:30') },
];
