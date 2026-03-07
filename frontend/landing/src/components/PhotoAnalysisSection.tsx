import React from "react";
import { Camera, Zap, Beaker } from "lucide-react";
import { PhotoAnalysisPreview } from "./PhotoAnalysisPreview";

export function PhotoAnalysisSection() {
  const points = [
    {
      icon: Camera,
      title: "AI identifies the dish",
      desc: "Snap a photo of your meal. AI recognizes the food and suggests a name.",
    },
    {
      icon: Zap,
      title: "Macros calculated instantly",
      desc: "Calories, protein, fat, carbs — all in one tap. Adjust portion size to recalculate.",
    },
    {
      icon: Beaker,
      title: "Micronutrients included",
      desc: "Fiber, sodium, zinc, iron and more. Full nutrition breakdown for every meal.",
    },
  ];

  return (
    <section className="py-20 px-6 bg-white/[0.02]">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="min-w-0">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Snap a photo.{" "}
              <span className="text-emerald-500">Get instant nutrition.</span>
            </h2>
            <p className="text-xl text-white/60 mb-10 leading-relaxed">
              No manual input, no calorie counting stress. Point your camera at the plate — AI analyzes the dish, estimates macros and micronutrients, and logs it to your day.
            </p>
            <ul className="space-y-6">
              {points.map((p) => (
                <li key={p.title} className="flex gap-4">
                  <div className="w-12 h-12 rounded-lg bg-emerald-600/20 flex items-center justify-center shrink-0">
                    <p.icon size={24} className="text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{p.title}</h3>
                    <p className="text-white/60 text-sm">{p.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative min-w-0">
            <div className="relative bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/20 rounded-2xl p-2 backdrop-blur shadow-2xl">
              <div className="bg-[#0f0f0f] rounded-xl overflow-hidden">
                <PhotoAnalysisPreview />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
