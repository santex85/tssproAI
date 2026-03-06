import React from 'react';
import { motion } from 'motion/react';
import * as Accordion from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    question: 'Who is tssAI for?',
    answer: 'tssAI is built for endurance athletes—runners, triathletes, cyclists, and anyone training with structured plans. Whether you\'re an amateur training for your first marathon or an age-group athlete chasing PRs, tssAI helps you make smarter training decisions by combining nutrition, recovery, and training load data.',
  },
  {
    question: 'Does it replace a coach?',
    answer: 'No. tssAI is designed to complement your training, not replace human coaching. It provides daily guidance based on your data and helps you understand whether you\'re ready to train hard. Many athletes use tssAI alongside their coaches to make better day-to-day decisions between coaching sessions.',
  },
  {
    question: 'Does it support Intervals.icu?',
    answer: 'Yes! tssAI integrates seamlessly with Intervals.icu, allowing you to pull in your training data automatically. You can continue using Intervals.icu for training planning while tssAI adds the nutrition, recovery, and AI decision-making layer on top.',
  },
  {
    question: 'Can I use it on web and mobile?',
    answer: 'Currently, tssAI is available as a web application that works on desktop and mobile browsers. A dedicated mobile app is in development and will be available soon.',
  },
  {
    question: 'What is included in Pro?',
    answer: 'Pro unlocks unlimited AI interactions, photo meal analysis, extended nutrient tracking, the AI Orchestrator for smart daily recommendations, advanced insights, FIT file imports, Intervals.icu integration, and priority support. The Free plan gives you basic tracking and limited AI to get started.',
  },
  {
    question: 'Is there a free trial?',
    answer: 'Yes! All new users get a 7-day free trial of Pro features. No credit card is required to start your trial. After 7 days, you can choose to continue with Pro or downgrade to the Free plan.',
  },
];

export function FAQSection() {
  return (
    <section id="faq" className="py-20 px-6 bg-[#0f0f0f]/50">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Frequently asked questions
          </h2>
          <p className="text-xl text-white/60">
            Everything you need to know about tssAI
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Accordion.Root type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <Accordion.Item
                key={index}
                value={`item-${index}`}
                className="bg-white/[0.02] border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition"
              >
                <Accordion.Header>
                  <Accordion.Trigger className="w-full px-6 py-5 flex items-center justify-between text-left group">
                    <span className="font-semibold text-lg pr-8">{faq.question}</span>
                    <ChevronDown
                      size={20}
                      className="text-white/60 transition-transform group-data-[state=open]:rotate-180 flex-shrink-0"
                    />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className="px-6 pb-5 text-white/70 leading-relaxed data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                  {faq.answer}
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 text-center"
        >
          <p className="text-white/60 mb-4">Still have questions?</p>
          <button className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-medium transition">
            Contact Support
          </button>
        </motion.div>
      </div>
    </section>
  );
}
