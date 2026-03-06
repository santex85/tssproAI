import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Zap } from 'lucide-react';

export function PricingSection() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  const freeFeatures = [
    'Basic nutrition tracking',
    'Manual workout logging',
    'Daily wellness check-ins',
    'Limited AI interactions',
    'Basic analytics',
  ];

  const proFeatures = [
    'Everything in Free',
    'Unlimited AI interactions',
    'Photo meal analysis',
    'Extended nutrient tracking',
    'AI Orchestrator for smart recommendations',
    'Advanced insights and trends',
    'FIT file imports',
    'Intervals.icu integration',
    'Priority support',
  ];

  return (
    <section id="pricing" className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto mb-8">
            Start with a free 7-day trial, then choose the plan that fits your needs
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-6 py-2 rounded-full font-medium transition ${
                billingPeriod === 'monthly'
                  ? 'bg-emerald-600 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              className={`px-6 py-2 rounded-full font-medium transition ${
                billingPeriod === 'annual'
                  ? 'bg-emerald-600 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Annual
              <span className="ml-2 text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                Save 33%
              </span>
            </button>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Free Plan */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="bg-white/[0.02] border border-white/10 rounded-2xl p-8"
          >
            <h3 className="text-2xl font-bold mb-2">Free</h3>
            <p className="text-white/60 mb-6">Get started with basic features</p>

            <div className="mb-8">
              <div className="text-5xl font-bold mb-2">$0</div>
              <div className="text-white/60">Forever free</div>
            </div>

            <button className="w-full px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-semibold transition mb-8">
              Start for free
            </button>

            <div className="space-y-4">
              {freeFeatures.map((feature, index) => (
                <div key={index} className="flex items-start gap-3">
                  <Check size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-white/80">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Pro Plan */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative bg-gradient-to-br from-emerald-950/30 to-emerald-950/10 border-2 border-emerald-500/30 rounded-2xl p-8"
          >
            {/* Popular badge */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-emerald-600 rounded-full text-sm font-semibold flex items-center gap-2">
              <Zap size={14} />
              Most Popular
            </div>

            <h3 className="text-2xl font-bold mb-2">Pro</h3>
            <p className="text-white/60 mb-6">Full AI-powered coaching experience</p>

            <div className="mb-8">
              {billingPeriod === 'monthly' ? (
                <>
                  <div className="text-5xl font-bold mb-2">
                    $9.99
                    <span className="text-2xl text-white/60 font-normal">/month</span>
                  </div>
                  <div className="text-white/60">Billed monthly</div>
                </>
              ) : (
                <>
                  <div className="text-5xl font-bold mb-2">
                    $79.99
                    <span className="text-2xl text-white/60 font-normal">/year</span>
                  </div>
                  <div className="text-white/60">
                    <span className="line-through">$119.88</span> • Save $39.89/year
                  </div>
                </>
              )}
            </div>

            <button className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold transition mb-2">
              Start 7-day free trial
            </button>
            <div className="text-center text-sm text-white/60 mb-8">
              No credit card required
            </div>

            <div className="space-y-4">
              {proFeatures.map((feature, index) => (
                <div key={index} className="flex items-start gap-3">
                  <Check size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-white/80">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 text-center text-white/60"
        >
          <p>All plans include access to web and mobile apps (when available)</p>
        </motion.div>
      </div>
    </section>
  );
}
