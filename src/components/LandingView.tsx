import React, { useMemo, useState } from 'react';
import { AppView } from '../types';
import { WhatsAppIcon, ChatIcon, CalendarIcon, ChartIcon } from './Icons';

interface LandingViewProps {
  setView: (view: AppView) => void;
  heroSlide: number;
  setHeroSlide: (index: number) => void;
  appCopyrightNotice: string;
}

type BillingCycle = 'monthly' | 'yearly';

type PlanKey = 'free' | 'basic' | 'premium';

interface PricingPlan {
  key: PlanKey;
  plan: string;
  monthlyPriceGhs: number;
  monthlyEquivalent: string;
  yearlyEquivalent: string;
  actionLabel: string;
  features: string[];
  featured?: boolean;
}

const heroSlides = [
  { title: 'Your Accountant', subtitle: 'On WhatsApp' },
  { title: 'Your Accountant', subtitle: 'On Telegram' },
  { title: 'Your Accountant', subtitle: 'On Web Chat' }
];

const pricingPlans: PricingPlan[] = [
  {
    key: 'free',
    plan: 'Free',
    monthlyPriceGhs: 0,
    monthlyEquivalent: 'GHS 0 • NGN 0 • ZMW 0 • USD 0',
    yearlyEquivalent: 'GHS 0 /yr • NGN 0 • ZMW 0 • USD 0',
    actionLabel: 'Create Account',
    features: [
      'Daily logging',
      'Weekly and monthly summaries',
      'Web chat + Telegram access',
      'Single-owner workspace'
    ]
  },
  {
    key: 'basic',
    plan: 'Basic',
    monthlyPriceGhs: 60,
    monthlyEquivalent: 'Approx: NGN 1,500 • ZMW 100 • USD 4',
    yearlyEquivalent: 'Approx yearly: NGN 15,000 • ZMW 1,000 • USD 40',
    actionLabel: 'Start Basic',
    features: [
      'Everything in Free',
      'WhatsApp channel access (paid)',
      'Reports and AI insights',
      'Cash-flow warnings + referral rewards'
    ]
  },
  {
    key: 'premium',
    plan: 'Premium',
    monthlyPriceGhs: 200,
    monthlyEquivalent: 'Approx: NGN 5,000 • ZMW 330 • USD 13',
    yearlyEquivalent: 'Approx yearly: NGN 50,000 • ZMW 3,300 • USD 130',
    actionLabel: 'Start Premium',
    features: [
      'Everything in Basic',
      'Team workspace (multi-user)',
      'Role-based access control',
      'Priority support'
    ],
    featured: true
  }
];

const testimonials = [
  {
    quote: 'Akonta AI helped me stop guessing. I now see my weekly inflow, expenses, and profit clearly.',
    owner: 'Ama, Salon Owner',
    location: 'Accra'
  },
  {
    quote: 'I run a mini mart with two staff. Premium roles helped us record faster while I keep full control.',
    owner: 'Chinedu, Mini Mart Owner',
    location: 'Lagos'
  },
  {
    quote: 'Daily chat logging is simple. Even when I am busy, my books stay up to date.',
    owner: 'Mutinta, Bakery Owner',
    location: 'Lusaka'
  },
  {
    quote: 'The monthly summary made it obvious where we were overspending, and we fixed it quickly.',
    owner: 'Kojo, Food Vendor',
    location: 'Kumasi'
  },
  {
    quote: 'Our credit sales and recoveries are finally tracked properly. This changed how we manage cash.',
    owner: 'Ifeanyi, Fashion Business Owner',
    location: 'Abuja'
  }
];

const faqs = [
  {
    q: '1. What is Akonta AI?',
    a: 'Akonta AI is a simple bookkeeping assistant for small businesses. It helps you record your daily sales, expenses, credit sales, stock purchases, owner withdrawals, and other money movements so you can understand how your business is performing.'
  },
  {
    q: '2. Who is Akonta AI made for?',
    a: 'Akonta AI is built for small business owners who want an easier way to manage their books without needing accounting knowledge. It is useful for salons, bakeries, food vendors, mini marts, provision shops, mobile money vendors, fashion designers, and other small businesses.'
  },
  {
    q: '3. Do I need to know accounting to use Akonta AI?',
    a: 'No. Akonta AI is designed to use simple business language. Instead of asking you to create complex accounting entries, it helps you record things like sales, expenses, stock purchases, credit sales, and cash received.'
  },
  {
    q: '4. Can I record both cash and mobile money sales?',
    a: 'Yes. Akonta AI helps you track different types of business transactions, including cash sales, mobile money sales, credit sales, debtor recoveries, stock purchases, and operating expenses.'
  },
  {
    q: '5. Can Akonta AI help me know if my business is making profit?',
    a: 'Yes. Akonta AI can summarize your revenue, expenses, and profit over a selected period. This helps you see whether your business is growing, overspending, or losing money.'
  },
  {
    q: '6. Can my staff use Akonta AI too?',
    a: 'Yes. Akonta AI supports business workspaces and different user roles such as owner, cashier, manager, bookkeeper, viewer, and accountant. This allows staff to help record transactions while the owner keeps control over sensitive business information.'
  },
  {
    q: '7. Can I approve or review transactions entered by my staff?',
    a: 'Yes. Akonta AI includes approval and audit features so business owners can review, approve, reject, or correct transactions. This helps reduce mistakes and improves trust in your records.'
  },
  {
    q: '8. Does Akonta AI support budgets?',
    a: 'Yes. You can set budgets for revenue or expenses and compare your actual business performance against your targets. This helps you control spending and plan ahead.'
  },
  {
    q: '9. Can Akonta AI replace my accountant?',
    a: 'Akonta AI helps with everyday bookkeeping, reporting, and business tracking. However, for tax filing, legal compliance, and advanced accounting advice, you may still need an accountant. Akonta AI helps you keep better records so your accountant has cleaner information to work with.'
  },
  {
    q: '10. What makes Akonta AI different from normal accounting software?',
    a: 'Akonta AI is built for small business owners who want simplicity. It focuses on everyday business activities like sales, expenses, mobile money, credit sales, stock purchases, and profit tracking. The goal is to make bookkeeping easy, practical, and less intimidating for business owners.'
  }
];

const featureToneMap = {
  green: {
    bg: 'bg-green-100',
    fg: 'text-green-600'
  },
  blue: {
    bg: 'bg-blue-100',
    fg: 'text-blue-600'
  },
  emerald: {
    bg: 'bg-emerald-100',
    fg: 'text-emerald-600'
  }
} as const;

const formatGhs = (amount: number): string => `GHS ${amount.toLocaleString('en-GH')}`;

export const LandingView: React.FC<LandingViewProps> = ({ setView, heroSlide, setHeroSlide, appCopyrightNotice }) => {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  const computedPricing = useMemo(() => {
    return pricingPlans.map((plan) => {
      if (billingCycle === 'monthly') {
        return {
          ...plan,
          displayPrice: formatGhs(plan.monthlyPriceGhs),
          suffix: '/mo',
          helper: plan.monthlyEquivalent,
          savingsLabel: null as string | null
        };
      }

      const yearlyAmount = plan.monthlyPriceGhs * 10;
      const regularYearly = plan.monthlyPriceGhs * 12;
      const savings = regularYearly - yearlyAmount;
      return {
        ...plan,
        displayPrice: formatGhs(yearlyAmount),
        suffix: '/yr',
        helper: plan.yearlyEquivalent,
        savingsLabel: savings > 0 ? `Save ${formatGhs(savings)} (2 months free)` : null
      };
    });
  }, [billingCycle]);

  const marqueeItems = [...testimonials, ...testimonials];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <style>{`
        @keyframes marqueeScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>

      <header className="px-4 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/brand/akonta.svg" alt="Akonta AI logo" className="h-10 w-auto object-contain" />
            <span className="text-xl font-bold text-gray-900">Akonta AI</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('auth')}
              className="px-4 py-2 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => setView('onboarding')}
              className="px-4 py-2 border border-green-200 text-green-700 rounded-full font-medium hover:bg-green-50 transition-colors"
            >
              Create Account
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 pt-12 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1fr]">
            <div className="relative overflow-hidden rounded-[2rem] border border-green-200 bg-[#06140d] shadow-2xl shadow-emerald-200/40">
              <img
                src="/brand/hero.png"
                alt="Akonta AI promotional hero: your accountant in your pocket"
                className="h-full w-full object-cover object-top"
                loading="eager"
              />
            </div>

            <div className="text-center lg:text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700">
                <WhatsAppIcon size={16} className="text-green-600" />
                Web Chat + Telegram + WhatsApp (Paid)
              </div>

              <p className="text-4xl md:text-5xl font-semibold text-gray-900">{heroSlides[heroSlide].title}</p>
              <p className="mt-2 text-5xl md:text-6xl font-bold text-green-600">{heroSlides[heroSlide].subtitle}</p>
              <p className="mt-5 max-w-2xl text-base md:text-lg text-gray-600 leading-relaxed mx-auto lg:mx-0">
                No complex spreadsheets. No accounting jargon. Just chat to track your business finances, get insights, and grow your business.
              </p>

              <div className="mt-6 flex justify-center gap-2 lg:justify-start">
                {heroSlides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setHeroSlide(index)}
                    className={`h-2.5 rounded-full transition-all ${heroSlide === index ? 'bg-green-600 w-8' : 'bg-gray-200 w-2.5'}`}
                  />
                ))}
              </div>

              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <button onClick={() => setView('auth')} className="px-8 py-4 bg-green-500 text-white rounded-2xl font-semibold text-lg hover:bg-green-600 transition-all shadow-lg shadow-green-200 flex items-center justify-center gap-2">
                  <WhatsAppIcon size={20} /> Sign In with OTP
                </button>
                <button onClick={() => setView('onboarding')} className="px-8 py-4 bg-white text-green-700 rounded-2xl font-semibold text-lg hover:bg-green-50 transition-all border border-green-200">
                  Create Account
                </button>
                <button onClick={() => setView('dashboard')} className="px-8 py-4 bg-white text-gray-700 rounded-2xl font-semibold text-lg hover:bg-gray-50 transition-all border border-gray-200">
                  View Demo
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-2">
            <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200 overflow-hidden border border-gray-100">
              <div className="bg-green-600 px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1.5">
                  <img src="/brand/akonta.svg" alt="Akonta AI" className="h-full w-full object-contain" />
                </div>
                <div><p className="text-white font-semibold">Akonta AI Chatflow</p><p className="text-green-100 text-xs">Online</p></div>
              </div>
              <div className="p-4 space-y-3 bg-gray-50 min-h-[300px]">
                <div className="flex justify-start"><div className="bg-white rounded-2xl px-4 py-2 shadow-sm max-w-[80%]"><p className="text-gray-800 text-sm">Good morning! How much inflow today?</p></div></div>
                <div className="flex justify-end"><div className="bg-green-500 rounded-2xl px-4 py-2 shadow-sm max-w-[80%]"><p className="text-white text-sm">I made 4500</p></div></div>
                <div className="flex justify-start"><div className="bg-white rounded-2xl px-4 py-2 shadow-sm max-w-[80%]"><p className="text-gray-800 text-sm">How much did you spend today?</p></div></div>
                <div className="flex justify-end"><div className="bg-green-500 rounded-2xl px-4 py-2 shadow-sm max-w-[80%]"><p className="text-white text-sm">Spent 200</p></div></div>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200 border border-gray-100 p-5">
              <p className="text-sm font-semibold text-gray-900 mb-4">Profit & Loss Preview</p>
              <div className="rounded-2xl border border-gray-200 overflow-hidden text-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-3"><p className="font-semibold text-gray-900">Business Summary</p></div>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex justify-between"><span>Revenue</span><span className="font-medium">GHS 7,000</span></div>
                  <div className="flex justify-between"><span>Expenses</span><span className="font-medium text-red-600">GHS 4,950</span></div>
                </div>
                <div className="bg-green-50 px-4 py-3 flex justify-between font-bold text-green-700"><span>Net Profit</span><span>GHS 2,050</span></div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-20">
            <FeatureCard icon={ChatIcon} title="Chat to Track" desc="Log sales and expenses by chat. Works on web, Telegram, and paid WhatsApp." tone="green" />
            <FeatureCard icon={CalendarIcon} title="Daily Reminders" desc="Never forget to log. Get friendly prompts at your preferred time." tone="blue" />
            <FeatureCard icon={ChartIcon} title="Smart Insights" desc="Ask for weekly/monthly profit and get clear inflow minus outflow reports." tone="emerald" />
          </div>

          <section className="mt-20">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Simple Pricing</h2>
              <p className="mt-2 text-gray-600">Choose monthly billing or yearly billing with 2 months free.</p>
            </div>

            <div className="mx-auto mt-6 w-fit rounded-full border border-green-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${billingCycle === 'monthly' ? 'bg-green-500 text-white' : 'text-gray-600 hover:text-green-700'}`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('yearly')}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${billingCycle === 'yearly' ? 'bg-green-500 text-white' : 'text-gray-600 hover:text-green-700'}`}
              >
                Yearly (2 Months Free)
              </button>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {computedPricing.map((plan) => (
                <PricingCard
                  key={plan.key}
                  plan={plan.plan}
                  priceLabel={plan.displayPrice}
                  equivalentLabel={plan.helper}
                  suffix={plan.suffix}
                  savingsLabel={plan.savingsLabel}
                  actionLabel={plan.actionLabel}
                  features={plan.features}
                  onAction={() => setView('onboarding')}
                  featured={plan.featured}
                />
              ))}
            </div>

            <p className="mt-4 text-center text-xs text-gray-500">
              Non-GHS prices are indicative equivalents and may vary by billing channel and FX movement.
            </p>
          </section>

          <section className="mt-20">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">What Business Owners Say</h2>
              <p className="mt-2 text-gray-600">Real feedback from everyday operators using Akonta AI.</p>
            </div>

            <div className="mt-8 overflow-hidden rounded-3xl border border-green-100 bg-white/80 py-5 shadow-sm">
              <div className="flex w-max gap-4 px-4" style={{ animation: 'marqueeScroll 30s linear infinite' }}>
                {marqueeItems.map((item, index) => (
                  <article key={`${item.owner}-${index}`} className="w-[320px] shrink-0 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <p className="text-sm leading-relaxed text-gray-700">“{item.quote}”</p>
                    <p className="mt-4 text-sm font-semibold text-gray-900">{item.owner}</p>
                    <p className="text-xs text-gray-500">{item.location}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-20">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Frequently Asked Questions</h2>
            </div>
            <div className="mt-8 space-y-4">
              {faqs.map((faq) => (
                <details key={faq.q} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm group">
                  <summary className="cursor-pointer list-none text-base font-semibold text-gray-900 pr-7 relative">
                    {faq.q}
                    <span className="absolute right-0 top-0 text-gray-400 group-open:rotate-45 transition-transform">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-gray-600">{faq.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-200 py-8 px-4">
        <div className="max-w-6xl mx-auto text-center text-gray-500 text-sm">
          <p>{appCopyrightNotice}</p>
        </div>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon: Icon, title, desc, tone }: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  title: string;
  desc: string;
  tone: keyof typeof featureToneMap;
}) => {
  const style = featureToneMap[tone];

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg shadow-gray-100 border border-gray-100">
      <div className={`w-12 h-12 ${style.bg} rounded-xl flex items-center justify-center mb-4`}>
        <Icon className={style.fg} size={24} />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 text-sm">{desc}</p>
    </div>
  );
};

const PricingCard = ({
  plan,
  priceLabel,
  equivalentLabel,
  features,
  onAction,
  featured,
  actionLabel = 'Create Account',
  suffix,
  savingsLabel
}: {
  plan: string;
  priceLabel: string;
  equivalentLabel: string;
  features: string[];
  onAction: () => void;
  featured?: boolean;
  actionLabel?: string;
  suffix: string;
  savingsLabel?: string | null;
}) => (
  <div className={`bg-white rounded-3xl border ${featured ? 'border-green-500' : 'border-gray-200'} p-6 shadow-sm`}>
    <div className="flex justify-between items-center mb-4">
      <div><p className="text-lg font-semibold">{plan} Plan</p></div>
      {featured && <span className="bg-green-500 text-white text-xs px-3 py-1 rounded-full font-semibold">Most Popular</span>}
    </div>
    <div className="py-8 text-center">
      <p className="text-4xl font-bold text-gray-900">{priceLabel}</p>
      <p className="text-sm text-gray-500">{suffix}</p>
      {savingsLabel ? <p className="mt-1 text-xs font-semibold text-green-600">{savingsLabel}</p> : null}
      <p className="mt-2 text-xs text-gray-500">{equivalentLabel}</p>
    </div>
    <div className="space-y-3 mb-6 text-sm text-gray-600">
      {features.map((feature) => <p key={feature}>✅ {feature}</p>)}
    </div>
    <button onClick={onAction} className={`w-full py-4 rounded-2xl font-semibold transition-colors ${featured ? 'bg-green-500 text-white hover:bg-green-600' : 'border border-green-500 text-green-600 hover:bg-green-50'}`}>
      {actionLabel}
    </button>
  </div>
);
