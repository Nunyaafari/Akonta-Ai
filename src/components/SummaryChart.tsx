import type { SummaryPayload } from '../types';

interface SummaryChartProps {
  weeklySummary: SummaryPayload;
  monthlySummary: SummaryPayload;
  monthLabel: string;
}

const formatCurrency = (amount: number) => `GHS ${amount.toLocaleString()}`;

export default function SummaryChart({ weeklySummary, monthlySummary, monthLabel }: SummaryChartProps) {
  const maxRevenue = Math.max(...weeklySummary.dailyBreakdown.map((day) => day.revenue), 1);
  const categoryData = Object.entries(monthlySummary.categoryBreakdown)
    .sort((a, b) => (b[1].expense - a[1].expense))
    .slice(0, 5);

  return (
    <>
      <div className="bg-white rounded-2xl shadow-lg shadow-gray-200 p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">This Week</h3>
          <span className="text-sm text-gray-500">Weekly</span>
        </div>
        <div className="text-center mb-6">
          <p className="text-sm text-gray-500 mb-1">Total Profit</p>
          <p className="text-4xl font-bold text-gray-900">{formatCurrency(weeklySummary.profit)}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-gray-500">Revenue</span>
            </div>
            <p className="text-lg font-bold text-green-600">{formatCurrency(weeklySummary.totalRevenue)}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-gray-500">Expenses</span>
            </div>
            <p className="text-lg font-bold text-red-600">{formatCurrency(weeklySummary.totalExpenses)}</p>
          </div>
        </div>
        <div className="mt-6">
          <div className="flex items-end justify-between h-32 gap-2">
            {weeklySummary.dailyBreakdown.map((day, _index) => (
              <div key={day.date} className="flex-1 flex flex-col items-center">
                <div
                  className="w-full bg-green-500 rounded-t-lg transition-all"
                  style={{ height: `${(day.revenue / maxRevenue) * 100}%`, minHeight: '8px' }}
                ></div>
                <p className="text-xs text-gray-400 mt-2">{new Date(day.date).toLocaleDateString('en-GH', { weekday: 'short' }).slice(0, 1)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg shadow-gray-200 p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">This Month</h3>
          <span className="text-sm text-gray-500">{monthLabel}</span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center mb-6">
          <div>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(monthlySummary.totalRevenue)}</p>
            <p className="text-xs text-gray-500">Revenue</p>
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(monthlySummary.totalExpenses)}</p>
            <p className="text-xs text-gray-500">Expenses</p>
          </div>
          <div>
            <p className="text-lg font-bold text-green-600">{formatCurrency(monthlySummary.profit)}</p>
            <p className="text-xs text-gray-500">Profit</p>
          </div>
        </div>
        <div className="space-y-3">
          {categoryData.map(([category, values], index) => {
            const percentage = monthlySummary.totalExpenses ? (values.expense / monthlySummary.totalExpenses) * 100 : 0;
            const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-blue-500'];
            return (
              <div key={category}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{category}</span>
                  <span className="font-medium text-gray-900">{formatCurrency(values.expense)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${colors[index]} rounded-full`} style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
