import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

export function FinalCTASection() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden"
        >
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-emerald-600/10 to-transparent rounded-3xl" />
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/10 via-transparent to-purple-600/10 rounded-3xl" />
          
          <div className="relative bg-white/[0.02] border border-white/10 rounded-3xl p-12 md:p-16 text-center backdrop-blur">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              Start training smarter today
            </h2>
            <p className="text-xl text-white/70 mb-10 max-w-2xl mx-auto">
              Join endurance athletes who are making better training decisions with AI-powered insights
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <button className="px-8 py-4 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold text-lg transition shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 group">
                Start 7-day free trial
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-lg font-semibold text-lg transition backdrop-blur">
                Open web app
              </button>
            </div>

            <div className="flex flex-wrap justify-center gap-6 text-sm text-white/60">
              <span>✓ No credit card required</span>
              <span>✓ Cancel anytime</span>
              <span>✓ Full access to Pro features during trial</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
