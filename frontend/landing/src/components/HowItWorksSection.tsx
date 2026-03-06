import React from "react";
import { Link2, Camera, Brain } from "lucide-react";

const steps = [
  { icon: Link2, title: "Connect your training and recovery data", desc: "Link Intervals.icu, import FIT files, or log manually." },
  { icon: Camera, title: "Add meals and wellness", desc: "Log meals from photos or text. Track sleep and wellness metrics." },
  { icon: Brain, title: "Get a daily recommendation", desc: "AI analyzes your context and tells you: GO, MODIFY, or SKIP. Plus long-term insights." },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center">How it works</h2>
        <p className="text-xl text-white/60 max-w-2xl mx-auto text-center mb-16">
          Three simple steps to smarter training decisions.
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <div key={s.title} className="relative">
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="w-12 h-12 rounded-lg bg-emerald-600/20 flex items-center justify-center mb-4 text-emerald-500">
                  <s.icon size={24} />
                </div>
                <div className="text-sm font-semibold text-emerald-500 mb-2">Step {i + 1}</div>
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-white/60 text-sm">{s.desc}</p>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-white/20" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
