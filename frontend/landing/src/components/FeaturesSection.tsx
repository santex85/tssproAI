import React from "react";
import { Camera, Moon, Brain, Upload, Link2, TrendingUp } from "lucide-react";

const features = [
  { icon: Camera, title: "Log meals from a photo", desc: "AI analyzes your food photos instantly. No manual input, no calorie counting stress.", color: "emerald" },
  { icon: Moon, title: "Track sleep and recovery", desc: "Monitor wellness metrics, sleep quality, and daily readiness to optimize recovery.", color: "blue" },
  { icon: Brain, title: "Get a daily AI decision", desc: "Should you GO hard, MODIFY your plan, or SKIP training? AI tells you based on all your data.", color: "purple" },
  { icon: Upload, title: "Import workouts and FIT files", desc: "Log workouts manually, upload FIT files, or snap a photo of your training notes.", color: "orange" },
  { icon: Link2, title: "Connect Intervals.icu", desc: "Seamless integration with your existing training platform. Keep using what you love.", color: "cyan" },
  { icon: TrendingUp, title: "See trends and ask AI about them", desc: "Visualize your progress and get AI insights on patterns in your training and recovery.", color: "pink" },
];

const colorMap: Record<string, { icon: string; border: string }> = {
  emerald: { icon: "text-emerald-500", border: "border-emerald-500/20" },
  blue: { icon: "text-blue-500", border: "border-blue-500/20" },
  purple: { icon: "text-purple-500", border: "border-purple-500/20" },
  orange: { icon: "text-orange-500", border: "border-orange-500/20" },
  cyan: { icon: "text-cyan-500", border: "border-cyan-500/20" },
  pink: { icon: "text-pink-500", border: "border-pink-500/20" },
};

export function FeaturesSection() {
  return (
    <section id="features" className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center">Features</h2>
        <p className="text-xl text-white/60 max-w-2xl mx-auto text-center mb-16">
          Everything you need to train smarter, recover better, and get actionable AI guidance.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => {
            const c = colorMap[f.color];
            return (
              <div
                key={f.title}
                className={`p-6 rounded-xl border ${c.border} bg-white/5 hover:bg-white/[0.07] transition`}
              >
                <div className={`w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center mb-4 ${c.icon}`}>
                  <f.icon size={24} />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-white/60 text-sm">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
