import React from "react";
import { Activity, Brain, TrendingUp, CheckCircle2 } from "lucide-react";
import { DashboardPreview } from "./DashboardPreview";

export function HeroSection({ appUrl }: { appUrl: string }) {
  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-transparent" />

      <div className="max-w-7xl mx-auto relative">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="min-w-0">
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

          <div className="relative min-w-0">
            <div className="relative bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/20 rounded-2xl p-2 backdrop-blur shadow-2xl">
              <div className="bg-[#0f0f0f] rounded-xl overflow-hidden">
                <DashboardPreview />
              </div>
            </div>

            <div className="absolute top-2 left-2 lg:top-4 lg:-left-8 bg-[#0f0f0f]/95 border border-white/20 rounded-lg p-3 shadow-2xl max-w-[160px] backdrop-blur">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md bg-emerald-600/20 flex items-center justify-center">
                  <Activity size={12} className="text-emerald-500" />
                </div>
                <span className="text-[10px] font-semibold">Meal Analysis</span>
              </div>
              <div className="text-lg font-bold mb-0.5">2,450 kcal</div>
              <div className="text-[10px] text-white/60">Logged from photo</div>
            </div>

            <div className="absolute bottom-2 right-2 lg:bottom-4 lg:-right-8 bg-[#0f0f0f]/95 border border-white/20 rounded-lg p-3 shadow-2xl max-w-[160px] backdrop-blur">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md bg-blue-600/20 flex items-center justify-center">
                  <Brain size={12} className="text-blue-500" />
                </div>
                <span className="text-[10px] font-semibold">Today&apos;s Decision</span>
              </div>
              <div className="text-base font-bold mb-0.5 text-emerald-500">GO</div>
              <div className="text-[10px] text-white/60">Ready for hard training</div>
            </div>

            <div className="absolute top-2 right-2 lg:top-4 lg:-right-8 bg-[#0f0f0f]/95 border border-white/20 rounded-lg p-3 shadow-2xl max-w-[150px] backdrop-blur">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md bg-purple-600/20 flex items-center justify-center">
                  <TrendingUp size={12} className="text-purple-500" />
                </div>
                <span className="text-[10px] font-semibold">AI Insight</span>
              </div>
              <div className="text-[10px] text-white/80">Your recovery trend is improving this week</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
