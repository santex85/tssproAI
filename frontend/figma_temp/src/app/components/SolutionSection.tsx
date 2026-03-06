import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, Target, Zap } from 'lucide-react';

const solutions = [
  {
    icon: Target,
    title: 'One unified context',
    description: 'All your training, nutrition, and wellness data in a single place, working together.',
  },
  {
    icon: Zap,
    title: 'Context-aware AI',
    description: 'AI that considers your nutrition, sleep, recovery, and training load—not just one metric.',
  },
  {
    icon: Sparkles,
    title: 'Actionable guidance',
    description: 'Clear daily decisions: GO, MODIFY, or SKIP. Plus insights you can actually use.',
  },
];

export function SolutionSection() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-950/30 border border-emerald-500/20 rounded-full mb-6">
            <Sparkles size={16} className="text-emerald-500" />
            <span className="text-sm font-medium text-emerald-400">The Solution</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            tssAI brings everything together
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            A single AI coach that understands your complete training picture
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {solutions.map((solution, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="relative group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 to-emerald-600/0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-white/[0.02] border border-white/10 rounded-2xl p-8 hover:border-emerald-500/30 transition">
                <div className="w-14 h-14 rounded-xl bg-emerald-950/30 border border-emerald-500/20 flex items-center justify-center mb-6">
                  <solution.icon size={28} className="text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold mb-3">{solution.title}</h3>
                <p className="text-white/60 leading-relaxed">{solution.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-16 text-center"
        >
          <div className="inline-block bg-gradient-to-r from-emerald-600/10 to-blue-600/10 border border-emerald-500/20 rounded-2xl p-8">
            <p className="text-lg font-semibold mb-2">
              Not just an AI chatbot—a complete training intelligence system
            </p>
            <p className="text-white/60">
              tssAI is designed specifically for endurance athletes who need real decisions, not just more data
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
