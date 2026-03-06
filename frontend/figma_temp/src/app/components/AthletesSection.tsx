import React from 'react';
import { motion } from 'motion/react';
import { ImageWithFallback } from './figma/ImageWithFallback';

const athletes = [
  {
    sport: 'Runners',
    description: 'Track your mileage, monitor recovery between runs, and fuel properly for long distances.',
    image: 'https://images.unsplash.com/photo-1758506971986-b0d0edebd8d5?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxydW5uZXIlMjBhdGhsZXRlJTIwdHJhaW5pbmclMjBlbmR1cmFuY2V8ZW58MXx8fHwxNzcyNzk5ODM0fDA&ixlib=rb-4.1.0&q=80&w=1080',
  },
  {
    sport: 'Triathletes',
    description: 'Manage complex training across swim, bike, run while optimizing nutrition and recovery.',
    image: 'https://images.unsplash.com/photo-1732335048549-671982c03b92?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0cmlhdGhsZXRlJTIwY3ljbGluZyUyMHNwb3J0c3xlbnwxfHx8fDE3NzI3OTk4MzR8MA&ixlib=rb-4.1.0&q=80&w=1080',
  },
  {
    sport: 'Cyclists',
    description: 'Balance high training volume with proper fueling and understand when you\'re ready to go hard.',
    image: 'https://images.unsplash.com/photo-1732335048549-671982c03b92?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0cmlhdGhsZXRlJTIwY3ljbGluZyUyMHNwb3J0c3xlbnwxfHx8fDE3NzI3OTk4MzR8MA&ixlib=rb-4.1.0&q=80&w=1080',
  },
];

export function AthletesSection() {
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
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Built for endurance athletes
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Whether you run, ride, or do all three, tssAI helps you make smarter training decisions
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {athletes.map((athlete, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="group"
            >
              <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden hover:border-emerald-500/30 transition">
                <div className="aspect-[4/3] overflow-hidden">
                  <ImageWithFallback
                    src={athlete.image}
                    alt={athlete.sport}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-6">
                  <h3 className="text-2xl font-bold mb-3">{athlete.sport}</h3>
                  <p className="text-white/60 leading-relaxed">{athlete.description}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
