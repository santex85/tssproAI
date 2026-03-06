import React from 'react';
import { motion } from 'motion/react';
import analyticsImage from 'figma:asset/421566c9a6e3b719d157fe35384969eab5483549.png';
import dashboardImage from 'figma:asset/a0a41d16d7cbb708a2cb5a059facb1d388fbe0e6.png';
import chatImage from 'figma:asset/8e2a1fa14dd6815c129d22a2d71ad1e8e9cb884c.png';

export function ProductShowcase() {
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
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Built for real training decisions
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Every feature is designed to help you understand your body and make smarter choices
          </p>
        </motion.div>

        {/* Featured screenshot - Dashboard */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <div className="inline-block px-4 py-2 bg-cyan-950/30 border border-cyan-500/20 rounded-full mb-4">
                <span className="text-sm font-medium text-cyan-400">Nutrition Tracking</span>
              </div>
              <h3 className="text-3xl font-bold mb-4">
                Visual macro tracking that makes sense
              </h3>
              <p className="text-white/70 leading-relaxed mb-6">
                See your daily nutrition at a glance with color-coded macros. Track calories, protein, fats, and carbs against your goals. Log meals with photos or manual entry—tssAI makes it simple to stay on top of your fueling strategy.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2" />
                  <span className="text-white/80">Real-time macro calculations</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2" />
                  <span className="text-white/80">Photo-based meal logging</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2" />
                  <span className="text-white/80">Detailed meal history</span>
                </li>
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <div className="bg-gradient-to-br from-cyan-950/20 to-transparent border border-white/10 rounded-2xl p-4 backdrop-blur">
                <img 
                  src={dashboardImage} 
                  alt="Nutrition Dashboard" 
                  className="w-full rounded-lg"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Featured screenshot - Analytics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-16"
        >
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="bg-gradient-to-br from-blue-950/20 to-transparent border border-white/10 rounded-2xl p-4 backdrop-blur">
                <img 
                  src={analyticsImage} 
                  alt="Analytics Dashboard" 
                  className="w-full rounded-lg"
                />
              </div>
            </div>
            <div>
              <div className="inline-block px-4 py-2 bg-blue-950/30 border border-blue-500/20 rounded-full mb-4">
                <span className="text-sm font-medium text-blue-400">Training Analytics</span>
              </div>
              <h3 className="text-3xl font-bold mb-4">
                Understand your training load and fitness trends
              </h3>
              <p className="text-white/70 leading-relaxed mb-6">
                Monitor TSS (Training Stress Score), CTL (Chronic Training Load), and ATL (Acute Training Load) to understand your fitness, fatigue, and form. Make data-driven decisions about when to push hard and when to recover.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
                  <span className="text-white/80">Daily TSS tracking</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
                  <span className="text-white/80">Fitness and fatigue curves</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
                  <span className="text-white/80">Multiple time period views</span>
                </li>
              </ul>
            </div>
          </div>
        </motion.div>

        {/* Featured screenshot - AI Chat */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <div className="inline-block px-4 py-2 bg-purple-950/30 border border-purple-500/20 rounded-full mb-4">
                <span className="text-sm font-medium text-purple-400">AI Coach</span>
              </div>
              <h3 className="text-3xl font-bold mb-4">
                Get personalized insights from your AI coach
              </h3>
              <p className="text-white/70 leading-relaxed mb-6">
                Ask questions about your training, recovery, and nutrition. The AI analyzes your complete picture—sleep, workouts, meals, and wellness—to give you actionable recommendations you can trust.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2" />
                  <span className="text-white/80">Context-aware responses</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2" />
                  <span className="text-white/80">Weekly training analysis</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2" />
                  <span className="text-white/80">Proactive guidance</span>
                </li>
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <div className="bg-gradient-to-br from-purple-950/20 to-transparent border border-white/10 rounded-2xl p-4 backdrop-blur">
                <img 
                  src={chatImage} 
                  alt="AI Coach Chat" 
                  className="w-full rounded-lg"
                />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
