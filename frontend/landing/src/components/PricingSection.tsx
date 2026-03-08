import React, { useState } from "react";
import { Check, Zap } from "lucide-react";

export function PricingSection() {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");

  const freeFeatures = [
    "3 AI food analyses / week",
    "Basic nutrition tracking",
    "Manual workout logging",
    "Daily wellness check-ins",
    "Basic analytics",
  ];

  const proFeatures = [
    "Unlimited AI food analyses",
    "Everything in Free",
    "Extended nutrient tracking",
    "AI Orchestrator for smart recommendations",
    "Advanced insights and trends",
    "FIT file imports",
    "Intervals.icu integration",
    "Priority support",
  ];

  return (
    <section id="pricing" className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center">Simple, transparent pricing</h2>
        <p className="text-xl text-white/60 max-w-3xl mx-auto text-center mb-8">
          Start with a free 7-day trial, then choose the plan that fits your needs
        </p>

        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 mx-auto flex justify-center mb-12">
          <button
            onClick={() => setBillingPeriod("monthly")}
            className={`px-6 py-2 rounded-full font-medium transition ${
              billingPeriod === "monthly" ? "bg-emerald-600 text-white" : "text-white/60 hover:text-white"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingPeriod("annual")}
            className={`px-6 py-2 rounded-full font-medium transition ${
              billingPeriod === "annual" ? "bg-emerald-600 text-white" : "text-white/60 hover:text-white"
            }`}
          >
            Annual
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
            <h3 className="text-xl font-semibold mb-2">Free</h3>
            <div className="text-3xl font-bold mb-4">$0</div>
            <p className="text-white/60 text-sm mb-6">Get started with core features</p>
            <ul className="space-y-3 mb-8">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check size={16} className="text-emerald-500" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-600 rounded-full text-xs font-semibold">
              Pro
            </div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xl font-semibold">Pro</h3>
              <Zap size={18} className="text-emerald-500" />
            </div>
            <div className="text-3xl font-bold mb-1">
              {billingPeriod === "monthly" ? "$9.99" : "$79.99"}
              <span className="text-lg font-normal text-white/60">/{billingPeriod === "monthly" ? "month" : "year"}</span>
            </div>
            {billingPeriod === "annual" && (
              <p className="text-emerald-400 text-sm mb-4">Save ~33%</p>
            )}
            <p className="text-white/60 text-sm mb-6">7-day free trial</p>
            <ul className="space-y-3 mb-8">
              {proFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check size={16} className="text-emerald-500" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
