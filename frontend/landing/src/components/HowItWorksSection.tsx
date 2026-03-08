import React from "react";
import { Link2, Camera, Brain, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Link2,
    title: "Connect Data",
    desc: "Link Intervals.icu, import FIT files, or log manually.",
    action: "Syncs automatically",
  },
  {
    icon: Camera,
    title: "Log Nutrition",
    desc: "Snap a photo of your meal. AI analyzes macros instantly.",
    action: " analyzing...",
  },
  {
    icon: Brain,
    title: "Get Guidance",
    desc: "AI combines training load + nutrition to guide you.",
    action: "MODIFY: Low readiness",
    isResult: true,
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 px-6 bg-white/5 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-900/5 to-transparent pointer-events-none" />
      
      <div className="max-w-7xl mx-auto relative">
        <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center">How it works</h2>
        <p className="text-xl text-white/60 max-w-2xl mx-auto text-center mb-16">
          From raw data to actionable advice in three steps.
        </p>

        <div className="relative grid md:grid-cols-3 gap-8 items-start">
          {/* Connection Lines (Desktop) */}
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-0.5 bg-gradient-to-r from-emerald-500/20 via-emerald-500/50 to-emerald-500/20 z-0" />

          {steps.map((s, i) => (
            <div key={s.title} className="relative z-10 flex flex-col items-center text-center">
              <div className="relative mb-6">
                <div className="w-24 h-24 rounded-2xl bg-[#0a0a0a] border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-emerald-900/20 relative z-10">
                  <s.icon size={40} className="text-emerald-500" />
                  {i < steps.length - 1 && (
                    <div className="md:hidden absolute -bottom-8 left-1/2 -translate-x-1/2 text-emerald-500/30">
                      <ArrowRight className="rotate-90" />
                    </div>
                  )}
                </div>
                {/* Pulse effect for the result step */}
                {s.isResult && (
                  <div className="absolute inset-0 bg-emerald-500/20 rounded-2xl animate-ping" />
                )}
              </div>

              <h3 className="text-xl font-bold mb-3">{s.title}</h3>
              <p className="text-white/60 text-sm mb-6 max-w-xs mx-auto">{s.desc}</p>

              {/* Visual "Card" representing the step's output */}
              <div className={`w-full max-w-[280px] rounded-lg p-4 text-left border ${
                s.isResult 
                  ? "bg-emerald-900/20 border-emerald-500/50 shadow-lg shadow-emerald-500/10" 
                  : "bg-white/5 border-white/10"
              }`}>
                <div className="text-xs text-white/40 mb-1 uppercase tracking-wider font-semibold">
                  {i === 0 ? "Input Source" : i === 1 ? "AI Analysis" : "Recommendation"}
                </div>
                <div className={`font-mono text-sm ${s.isResult ? "text-emerald-400 font-bold" : "text-white/80"}`}>
                  {s.isResult ? (
                    <>
                      <span className="text-yellow-400">⚠ MODIFY</span><br/>
                      Reduce intensity by 20% due to low carb intake yesterday.
                    </>
                  ) : (
                    s.action
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
