import React from 'react';
import { AppView } from '../types';
import { WhatsAppIcon, ChatIcon, CalendarIcon, ChartIcon } from './Icons';

interface LandingViewProps {
  setView: (view: AppView) => void;
  heroSlide: number;
  setHeroSlide: (index: number) => void;
  appCopyrightNotice: string;
}

const heroSlides = [
  { title: 'Your Accountant', subtitle: 'On WhatsApp' },
  { title: 'Your Accountant', subtitle: 'On Web Chat' }
];

export const LandingView: React.FC<LandingViewProps> = ({ setView, heroSlide, setHeroSlide, appCopyrightNotice }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <header className="px-4 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/brand/akonta.svg" alt="Akonta AI logo" className="h-10 w-auto object-contain" />
            <span className="text-xl font-bold text-gray-900">Akonta AI</span>
          </div>
          <button onClick={() => setView('auth')} className="px-4 py-2 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 transition-colors">
            Sign In
          </button>
        </div>
      </header>

      <main className="px-4 pt-12 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
              <WhatsAppIcon size={16} className="text-green-600" />
              Web Chat + WhatsApp
            </div>

            <div className="relative mb-8 overflow-hidden rounded-[2rem] border border-green-100 bg-white/80 p-8 shadow-2xl shadow-green-100">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-3xl md:text-4xl font-semibold text-gray-900">{heroSlides[heroSlide].title}</p>
                <p className="text-4xl md:text-5xl font-bold text-green-600">{heroSlides[heroSlide].subtitle}</p>
                <p className="max-w-2xl text-base md:text-lg text-gray-600 leading-relaxed">
                  No complex spreadsheets. No accounting jargon. Just chat to track your business finances, get insights, and grow your business.
                </p>
              </div>
              <div className="mt-6 flex justify-center gap-2">
                {heroSlides.map((_, index) => (
                  <button key={index} onClick={() => setHeroSlide(index)} className={`h-2.5 w-2.5 rounded-full transition-all ${heroSlide === index ? 'bg-green-600 w-8' : 'bg-gray-200 w-2.5'}`} />
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
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

          <div className="mx-auto mt-2 grid max-w-5xl gap-6 lg:grid-cols-2">
            <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200 overflow-hidden border border-gray-100">
              <div className="bg-green-600 px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1.5">
                  <img src="/brand/akonta.svg" alt="Akonta AI" className="h-full w-full object-contain" />
                </div>
                <div><p className="text-white font-semibold">Akonta AI Chatflow</p><p className="text-green-100 text-xs">Online</p></div>
              </div>
              <div className="p-4 space-y-3 bg-gray-50 min-h-[300px]">
                <div className="flex justify-start"><div className="bg-white rounded-2xl px-4 py-2 shadow-sm max-w-[80%]"><p className="text-gray-800 text-sm">Good morning! ☀️ How much inflow today?</p></div></div>
                <div className="flex justify-end"><div className="bg-green-500 rounded-2xl px-4 py-2 shadow-sm max-w-[80%]"><p className="text-white text-sm">I made 4500</p></div></div>
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
            <FeatureCard icon={ChatIcon} title="Chat to Track" desc="Log sales and expenses by messaging. Works on Web and WhatsApp." color="green" />
            <FeatureCard icon={CalendarIcon} title="Daily Reminders" desc="Never forget to log. Get friendly prompts at your preferred time." color="blue" />
            <FeatureCard icon={ChartIcon} title="Smart Insights" desc="Get weekly summaries and AI-powered recommendations." color="purple" />
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-2">
            <PricingCard plan="Free" price="0" features={["Daily logging", "Weekly summaries", "Monthly summaries"]} onAction={() => setView('onboarding')} />
            <PricingCard plan="Premium" price="50" features={["Advanced AI insights", "Expense breakdown", "Cash flow warnings", "PDF reports"]} onAction={() => setView('onboarding')} featured />
          </div>
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

const FeatureCard = ({ icon: Icon, title, desc, color }: any) => (
  <div className="bg-white rounded-2xl p-6 shadow-lg shadow-gray-100 border border-gray-100">
    <div className={`w-12 h-12 bg-${color}-100 rounded-xl flex items-center justify-center mb-4`}>
      <Icon className={`text-${color}-600`} size={24} />
    </div>
    <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600 text-sm">{desc}</p>
  </div>
);

const PricingCard = ({ plan, price, features, onAction, featured }: any) => (
  <div className={`bg-white rounded-3xl border ${featured ? 'border-green-500' : 'border-gray-200'} p-6 shadow-sm`}>
    <div className="flex justify-between items-center mb-4">
      <div><p className="text-lg font-semibold">{plan} Plan</p></div>
      {featured && <span className="bg-green-500 text-white text-xs px-3 py-1 rounded-full font-semibold">Most Popular</span>}
    </div>
    <div className="py-8 text-center">
      <p className="text-5xl font-bold text-gray-900">¢{price}</p>
      <p className="text-sm text-gray-500">/mo</p>
    </div>
    <div className="space-y-3 mb-6 text-sm text-gray-600">
      {features.map((f: string) => <p key={f}>✅ {f}</p>)}
    </div>
    <button onClick={onAction} className={`w-full py-4 rounded-2xl font-semibold transition-colors ${featured ? 'bg-green-500 text-white hover:bg-green-600' : 'border border-green-500 text-green-600 hover:bg-green-50'}`}>
      Get Started
    </button>
  </div>
);
