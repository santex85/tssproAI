import React from "react";

export function SolutionSection() {
  return (
    <section className="py-20 px-6 bg-white/[0.02]">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold mb-6 text-center">
          One place. One context. <span className="text-emerald-500">Actionable guidance.</span>
        </h2>
        <p className="text-xl text-white/60 max-w-3xl mx-auto text-center mb-12">
          tssAI brings nutrition, sleep, wellness, and training load together. AI doesn&apos;t just answer — it considers your full context and tells you: GO, MODIFY, or SKIP.
        </p>
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600/20 border border-emerald-500/30 rounded-lg text-emerald-400">
            <span className="font-semibold">Result:</span> Daily training decisions based on real data
          </div>
        </div>
      </div>
    </section>
  );
}
