import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import analyticsImage from 'figma:asset/421566c9a6e3b719d157fe35384969eab5483549.png';
import dashboardImage from 'figma:asset/a0a41d16d7cbb708a2cb5a059facb1d388fbe0e6.png';
import chatImage from 'figma:asset/8e2a1fa14dd6815c129d22a2d71ad1e8e9cb884c.png';

const screenshots = [
  {
    title: 'Dashboard',
    description: 'Track your daily nutrition with visual macros breakdown and meal logging',
    image: dashboardImage,
  },
  {
    title: 'Analytics',
    description: 'Monitor training load (TSS), fitness (CTL), and fatigue (ATL) trends over time',
    image: analyticsImage,
  },
  {
    title: 'AI Coach',
    description: 'Get personalized insights and recommendations based on your complete training picture',
    image: chatImage,
  },
];

export function ScreenshotsSection() {
  const [currentIndex, setCurrentIndex] = useState(0);

  const next = () => {
    setCurrentIndex((prev) => (prev + 1) % screenshots.length);
  };

  const previous = () => {
    setCurrentIndex((prev) => (prev - 1 + screenshots.length) % screenshots.length);
  };

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
            See tssAI in action
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Real product screenshots showing how tssAI helps you train smarter
          </p>
        </motion.div>

        <div className="relative max-w-5xl mx-auto">
          {/* Main screenshot */}
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="relative"
          >
            <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 md:p-8 backdrop-blur">
              <div className="aspect-video bg-[#0a0a0a] rounded-lg overflow-hidden">
                <img
                  src={screenshots[currentIndex].image}
                  alt={screenshots[currentIndex].title}
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* Navigation buttons */}
            <button
              onClick={previous}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 md:-translate-x-12 w-12 h-12 bg-[#0f0f0f] border border-white/10 rounded-full flex items-center justify-center hover:border-emerald-500/30 transition"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={next}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 md:translate-x-12 w-12 h-12 bg-[#0f0f0f] border border-white/10 rounded-full flex items-center justify-center hover:border-emerald-500/30 transition"
            >
              <ChevronRight size={24} />
            </button>
          </motion.div>

          {/* Screenshot info */}
          <motion.div
            key={`info-${currentIndex}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="text-center mt-8"
          >
            <h3 className="text-2xl font-bold mb-2">{screenshots[currentIndex].title}</h3>
            <p className="text-white/60">{screenshots[currentIndex].description}</p>
          </motion.div>

          {/* Dots indicator */}
          <div className="flex justify-center gap-2 mt-8">
            {screenshots.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className={`w-2 h-2 rounded-full transition ${
                  index === currentIndex ? 'bg-emerald-500 w-8' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}