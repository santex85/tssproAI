import React from "react";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Alex M.",
    role: "Triathlete",
    content: "Finally an app that connects the dots between my nutrition and training. The daily readiness score is scary accurate.",
    rating: 5,
  },
  {
    name: "Sarah K.",
    role: "Marathon Runner",
    content: "I used to guess my recovery. Now I know exactly when to push and when to back off. Set a PB in my last marathon thanks to this.",
    rating: 5,
  },
  {
    name: "Mike T.",
    role: "Cyclist",
    content: "The food photo analysis is a game changer. No more manual logging, just snap and go. It's like having a coach in my pocket.",
    rating: 5,
  },
];

export function TestimonialsSection() {
  return (
    <section className="py-20 px-6 bg-white/5">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center">Trusted by athletes</h2>
        <p className="text-xl text-white/60 max-w-2xl mx-auto text-center mb-16">
          See what early adopters are saying about tssAI.
        </p>
        
        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((t, i) => (
            <div key={i} className="bg-[#0a0a0a] border border-white/10 rounded-xl p-8 flex flex-col">
              <div className="flex gap-1 mb-4">
                {[...Array(t.rating)].map((_, i) => (
                  <Star key={i} size={16} className="fill-emerald-500 text-emerald-500" />
                ))}
              </div>
              <p className="text-white/80 mb-6 flex-grow">"{t.content}"</p>
              <div>
                <div className="font-semibold">{t.name}</div>
                <div className="text-sm text-white/60">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
