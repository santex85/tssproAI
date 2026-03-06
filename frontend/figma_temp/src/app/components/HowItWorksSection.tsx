import React from 'react';
import { motion } from 'motion/react';
import { Link2, Camera, Sparkles } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: Link2,
    title: 'Connect your training and recovery data',
    description: 'Import from Intervals.icu, upload FIT files, or log workouts manually. Add your existing training foundation.',
  },
  {
    number: '02',
    icon: Camera,
    title: 'Add meals and wellness manually or with photos',
    description: 'Snap a photo of your meal for instant AI analysis, or track your sleep and recovery metrics daily.',
  },
  {
    number: '03',
    icon: Sparkles,
    title: 'Get a daily recommendation and long-term AI insights',
    description: 'Every day, see if you should GO, MODIFY, or SKIP training. Ask AI about trends and get actionable guidance.',
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            How it works
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Three simple steps to smarter training decisions
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connecting lines */}
          <div className="hidden md:block absolute top-24 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className="relative"
            >
              <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-8 hover:border-emerald-500/30 transition">
                {/* Step number */}
                <div className="text-6xl font-bold text-white/5 mb-4">{step.number}</div>
                
                {/* Icon */}
                <div className="w-16 h-16 rounded-xl bg-emerald-950/30 border border-emerald-500/20 flex items-center justify-center mb-6 -mt-16 relative">
                  <step.icon size={32} className="text-emerald-500" />
                </div>

                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-white/60 leading-relaxed">{step.description}</p>
              </div>

              {/* Arrow indicator for mobile */}
              {index < steps.length - 1 && (
                <div className="md:hidden flex justify-center my-4">
                  <div className="w-0.5 h-8 bg-white/10" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
