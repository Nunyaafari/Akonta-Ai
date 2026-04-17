export interface SalesProfitTrendPoint {
  key: string;
  label: string;
  sales: number;
  profit: number;
}

interface SalesProfitTrendChartProps {
  points: SalesProfitTrendPoint[];
  formatCurrency: (amount: number) => string;
}

const chartWidth = 760;
const chartHeight = 280;
const padding = { top: 20, right: 24, bottom: 46, left: 52 };

const toLinePath = (points: Array<{ x: number; y: number }>): string =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

export default function SalesProfitTrendChart({ points, formatCurrency }: SalesProfitTrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
        No sales/profit trend data for this period yet.
      </div>
    );
  }

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const values = points.flatMap((point) => [point.sales, point.profit]);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const range = maxValue - minValue || 1;
  const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const toX = (index: number) => padding.left + index * xStep;
  const toY = (value: number) => padding.top + ((maxValue - value) / range) * innerHeight;
  const zeroY = toY(0);

  const salesPoints = points.map((point, index) => ({ x: toX(index), y: toY(point.sales), point }));
  const profitPoints = points.map((point, index) => ({ x: toX(index), y: toY(point.profit), point }));
  const salesPath = toLinePath(salesPoints);
  const profitPath = toLinePath(profitPoints);

  const yTicks = [0, 1, 2, 3, 4].map((step) => {
    const value = maxValue - (range * step) / 4;
    return { value, y: toY(value) };
  });
  const labelStride = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full">
        {yTicks.map((tick) => (
          <g key={`grid-${tick.y}`}>
            <line x1={padding.left} y1={tick.y} x2={chartWidth - padding.right} y2={tick.y} stroke="#E5E7EB" strokeWidth="1" />
            <text x={padding.left - 8} y={tick.y + 4} textAnchor="end" fontSize="10" fill="#6B7280">
              {Math.round(tick.value).toLocaleString()}
            </text>
          </g>
        ))}

        <line x1={padding.left} y1={zeroY} x2={chartWidth - padding.right} y2={zeroY} stroke="#9CA3AF" strokeDasharray="4 3" strokeWidth="1" />

        <path d={salesPath} fill="none" stroke="#0EA5E9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={profitPath} fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {salesPoints.map(({ x, y, point }, index) => (
          <g key={`sales-${point.key}`}>
            <circle cx={x} cy={y} r="3" fill="#0EA5E9" />
            {(index % labelStride === 0 || index === points.length - 1) && (
              <text x={x} y={chartHeight - 16} textAnchor="middle" fontSize="10" fill="#6B7280">
                {point.label}
              </text>
            )}
          </g>
        ))}
        {profitPoints.map(({ x, y, point }) => (
          <circle key={`profit-${point.key}`} cx={x} cy={y} r="3" fill={point.profit >= 0 ? '#16A34A' : '#B91C1C'} />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" />Sales</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-600" />Profit</span>
        <span>Peak sales: {formatCurrency(Math.max(...points.map((point) => point.sales)))}</span>
        <span>Peak profit: {formatCurrency(Math.max(...points.map((point) => point.profit)))}</span>
      </div>
    </div>
  );
}
