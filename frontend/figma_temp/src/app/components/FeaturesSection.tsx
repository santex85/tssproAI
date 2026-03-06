import React from 'react';
import { motion } from 'motion/react';
import { 
  Camera, 
  Moon, 
  Brain, 
  Upload, 
  Link2, 
  TrendingUp 
} from 'lucide-react';

const features = [
  {
    icon: Camera,
    title: 'Log meals from a photo',
    description: 'AI analyzes your food photos instantly. No manual input, no calorie counting stress.',
    color: 'emerald',
  },
  {
    icon: Moon,
    title: 'Track sleep and recovery',
    description: 'Monitor wellness metrics, sleep quality, and daily readiness to optimize recovery.',
    color: 'blue',
  },
  {
    icon: Brain,
    title: 'Get a daily AI decision',
    description: 'Should you GO hard, MODIFY your plan, or SKIP training? AI tells you based on all your data.',
    color: 'purple',
  },
  {
    icon: Upload,
    title: 'Import workouts and FIT files',
    description: 'Log workouts manually, upload FIT files, or snap a photo of your training notes.',
    color: 'orange',
  },
  {
    icon: Link2,
    title: 'Connect Intervals.icu',
    description: 'Seamless integration with your existing training platform. Keep using what you love.',
    color: 'cyan',
  },
  {
    icon: TrendingUp,
    title: 'See trends and ask AI about them',
    description: 'Visualize your progress and get AI insights on patterns in your training and recovery.',
    color: 'pink',
  },
];

const colorClasses = {
  emerald: {
    bg: 'bg-emerald-950/30',
    border: 'border-emerald-500/20',
    text: 'text-emerald-500',
    hover: 'group-hover:border-emerald-500/30',
  },
  blue: {
    bg: 'bg-blue-950/30',
    border: 'border-blue-500/20',
    text: 'text-blue-500',
    hover: 'group-hover:border-blue-500/30',
  },
  purple: {
    bg: 'bg-purple-950/30',
    border: 'border-purple-500/20',
    text: 'text-purple-500',
    hover: 'group-hover:border-purple-500/30',
  },
  orange: {
    bg: 'bg-orange-950/30',
    border: 'border-orange-500/20',
    text: 'text-orange-500',
    hover: 'group-hover:border-orange-500/30',
  },
  cyan: {
    bg: 'bg-cyan-950/30',
    border: 'border-cyan-500/20',
    text: 'text-cyan-500',
    hover: 'group-hover:border-cyan-500/30',
  },
  pink: {
    bg: 'bg-pink-950/30',
    border: 'border-pink-500/20',
    text: 'text-pink-500',
    hover: 'group-hover:border-pink-500/30',
  },
};

export function FeaturesSection() {
  return (
    <section id="features" className="py-20 px-6 bg-[#0f0f0f]/50">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Everything you need in one place
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Powerful features designed specifically for endurance athletes
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const colors = colorClasses[feature.color as keyof typeof colorClasses];
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.05 }}
                className="group"
              >
                <div className={`bg-white/[0.02] border border-white/10 rounded-2xl p-8 h-full hover:bg-white/[0.04] transition ${colors.hover}`}>
                  <div className={`w-14 h-14 rounded-xl ${colors.bg} ${colors.border} flex items-center justify-center mb-6`}>
                    <feature.icon size={28} className={colors.text} />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-white/60 leading-relaxed">{feature.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
