import React from "react";

export function ProblemSection() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-6 text-center">
          Nutrition, recovery, and training — scattered everywhere
        </h2>
        <p className="text-xl text-white/60 max-w-3xl mx-auto text-center mb-12">
          You track meals in one app, sleep in another, workouts somewhere else. You see lots of metrics but no clear answer: what should I do today?
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h3 className="font-semibold mb-2">Multiple apps</h3>
            <p className="text-white/60 text-sm">Data lives in different places. No single view of your readiness.</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h3 className="font-semibold mb-2">Metrics without decisions</h3>
            <p className="text-white/60 text-sm">Charts and numbers, but no clear guidance on what to do next.</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h3 className="font-semibold mb-2">Context is lost</h3>
            <p className="text-white/60 text-sm">Training load ignores sleep and nutrition. Recovery ignores load.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
