import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  { q: "Who is tssAI for?", a: "tssAI is built for endurance athletes: runners, triathletes, cyclists, and anyone who trains with a plan and wants to optimize recovery, nutrition, and training load." },
  { q: "Does it replace a coach?", a: "tssAI complements your training. It gives you daily AI guidance based on your data. Many use it alongside a coach or as a self-coaching tool." },
  { q: "Does it support Intervals.icu?", a: "Yes. Intervals.icu integration lets you sync workouts and training load automatically." },
  { q: "Can I use it on web and mobile?", a: "Yes. tssAI works on web and mobile (iOS, Android) so you can log meals, check readiness, and chat with AI anywhere." },
  { q: "What is included in Pro?", a: "Pro includes unlimited AI, photo meal analysis, extended nutrients, AI Orchestrator, advanced insights, FIT imports, Intervals.icu, and priority support." },
  { q: "Is there a free trial?", a: "Yes. Pro comes with a 7-day free trial. No credit card required to start." },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center">FAQ</h2>
        <p className="text-xl text-white/60 text-center mb-12">
          Common questions about tssAI
        </p>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <div
              key={faq.q}
              className="bg-white/5 border border-white/10 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition"
              >
                <span className="font-medium">{faq.q}</span>
                <ChevronDown size={20} className={`text-white/60 transition ${openIndex === i ? "rotate-180" : ""}`} />
              </button>
              {openIndex === i && (
                <div className="px-4 pb-4 text-white/60 text-sm">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
