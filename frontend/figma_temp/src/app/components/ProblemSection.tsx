import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, BarChart3, Smartphone, TrendingDown } from 'lucide-react';

const problems = [
  {
    icon: Smartphone,
    title: 'Data lives in different apps',
    description: 'Your nutrition, sleep, and training are scattered across multiple platforms with no unified view.',
  },
  {
    icon: BarChart3,
    title: 'Too many metrics, no clarity',
    description: 'You see dozens of charts and numbers, but still don\'t know if you should train hard today.',
  },
  {
    icon: TrendingDown,
    title: 'Data, not decisions',
    description: 'Existing tools show you what happened, but don\'t tell you what to do next.',
  },
];

export function ProblemSection() {
  return (
    <section className="py-20 px-6 bg-[#0f0f0f]/50">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-950/30 border border-red-500/20 rounded-full mb-6">
            <AlertCircle size={16} className="text-red-500" />
            <span className="text-sm font-medium text-red-400">The Problem</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Disconnected data doesn't help you train smarter
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Most athletes struggle with fragmented information and unclear guidance
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {problems.map((problem, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="bg-white/[0.02] border border-white/10 rounded-2xl p-8 hover:border-white/20 transition"
            >
              <div className="w-14 h-14 rounded-xl bg-red-950/30 border border-red-500/20 flex items-center justify-center mb-6">
                <problem.icon size={28} className="text-red-500" />
              </div>
              <h3 className="text-xl font-bold mb-3">{problem.title}</h3>
              <p className="text-white/60 leading-relaxed">{problem.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
