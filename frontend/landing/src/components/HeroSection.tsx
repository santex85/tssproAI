import React from "react";
import { Activity, Brain, TrendingUp, CheckCircle2 } from "lucide-react";

export function HeroSection({ appUrl }: { appUrl: string }) {
  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-transparent" />

      <div className="max-w-7xl mx-auto relative">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              AI coach for{" "}
              <span className="text-emerald-500">endurance athletes</span>
            </h1>

            <p className="text-xl text-white/70 mb-8 leading-relaxed">
              Track nutrition, sleep, training load and daily readiness in one app. Get actionable AI guidance, not just charts.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <a
                href={appUrl}
                className="inline-block px-8 py-4 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold text-lg transition shadow-lg shadow-emerald-600/20 text-center"
              >
                Start free trial
              </a>
              <a
                href={appUrl}
                className="inline-block px-8 py-4 bg-white/10 hover:bg-white/20 rounded-lg font-semibold text-lg transition backdrop-blur text-center"
              >
                Open web app
              </a>
            </div>

            <div className="flex flex-wrap gap-6 text-sm text-white/60">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                7-day free trial
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                Photo, FIT and Intervals.icu support
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                Built for endurance athletes
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="relative bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/20 rounded-2xl p-2 backdrop-blur shadow-2xl">
              <div className="aspect-[4/3] bg-[#0f0f0f] rounded-xl flex items-center justify-center">
                <div className="text-white/40 text-center p-8">
                  <div className="text-4xl mb-4">📊</div>
                  <p className="text-sm">Dashboard preview</p>
                </div>
              </div>
            </div>

            <div className="absolute top-0 -left-4 lg:-left-12 bg-[#0f0f0f]/95 border border-white/20 rounded-xl p-4 shadow-2xl max-w-[200px] backdrop-blur">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center">
                  <Activity size={16} className="text-emerald-500" />
                </div>
                <span className="text-xs font-semibold">Meal Analysis</span>
              </div>
              <div className="text-2xl font-bold mb-1">2,450 kcal</div>
              <div className="text-xs text-white/60">Logged from photo</div>
            </div>

            <div className="absolute bottom-0 -right-4 lg:-right-12 bg-[#0f0f0f]/95 border border-white/20 rounded-xl p-4 shadow-2xl max-w-[200px] backdrop-blur">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
                  <Brain size={16} className="text-blue-500" />
                </div>
                <span className="text-xs font-semibold">Today&apos;s Decision</span>
              </div>
              <div className="text-lg font-bold mb-1 text-emerald-500">GO</div>
              <div className="text-xs text-white/60">Ready for hard training</div>
            </div>

            <div className="absolute top-1/2 -translate-y-1/2 -right-4 bg-[#0f0f0f]/95 border border-white/20 rounded-xl p-4 shadow-2xl max-w-[180px] backdrop-blur">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center">
                  <TrendingUp size={16} className="text-purple-500" />
                </div>
                <span className="text-xs font-semibold">AI Insight</span>
              </div>
              <div className="text-xs text-white/80">Your recovery trend is improving this week</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
