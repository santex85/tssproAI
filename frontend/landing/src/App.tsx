import React from "react";
import { Header } from "./components/Header";
import { HeroSection } from "./components/HeroSection";
import { ProblemSection } from "./components/ProblemSection";
import { SolutionSection } from "./components/SolutionSection";
import { FeaturesSection } from "./components/FeaturesSection";
import { PhotoAnalysisSection } from "./components/PhotoAnalysisSection";
import { HowItWorksSection } from "./components/HowItWorksSection";
import { PricingSection } from "./components/PricingSection";
import { FAQSection } from "./components/FAQSection";
import { TestimonialsSection } from "./components/TestimonialsSection";
import { FinalCTASection } from "./components/FinalCTASection";

const APP_URL = import.meta.env.VITE_APP_URL || "https://app.tsspro.tech";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Header appUrl={APP_URL} />
      <main>
        <HeroSection appUrl={APP_URL} />
        <ProblemSection />
        <SolutionSection />
        <FeaturesSection />
        <PhotoAnalysisSection />
        <HowItWorksSection />
        <PricingSection />
        <TestimonialsSection />
        <FAQSection />
        <FinalCTASection appUrl={APP_URL} />
      </main>
      <footer className="border-t border-white/10 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="text-2xl font-bold mb-4">tssAI</div>
              <p className="text-white/60 text-sm">AI coach for endurance athletes</p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-white/60">
                <li><a href="#features" className="hover:text-white transition">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition">How it works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-white/60">
                <li><a href="#faq" className="hover:text-white transition">FAQ</a></li>
                <li><a href={APP_URL} className="hover:text-white transition">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-white/60">
                <li><a href={`${APP_URL}/privacy`} className="hover:text-white transition">Privacy Policy</a></li>
                <li><a href={`${APP_URL}/terms`} className="hover:text-white transition">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-white/10 text-center text-sm text-white/40">
            © {new Date().getFullYear()} tssAI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
