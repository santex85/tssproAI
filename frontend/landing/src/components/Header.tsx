import React, { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { useLandingTranslation } from "../i18n";

export function Header({ appUrl }: { appUrl: string }) {
  const { t, locale, setLocale } = useLandingTranslation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setIsMobileMenuOpen(false);
    }
  };

  const LangToggle = () => (
    <div className="flex items-center gap-1 text-sm text-white/60">
      <button
        onClick={() => setLocale("ru")}
        className={`px-2 py-1 rounded transition ${locale === "ru" ? "text-white font-medium" : "hover:text-white"}`}
      >
        RU
      </button>
      <span className="text-white/40">|</span>
      <button
        onClick={() => setLocale("en")}
        className={`px-2 py-1 rounded transition ${locale === "en" ? "text-white font-medium" : "hover:text-white"}`}
      >
        EN
      </button>
    </div>
  );

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled || isMobileMenuOpen ? "bg-[#0a0a0a]/98 backdrop-blur-lg border-b border-white/10" : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold tracking-tight">
            tss<span className="text-emerald-500">AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <button onClick={() => scrollToSection("features")} className="text-sm text-white/70 hover:text-white transition">
              {t("header.features")}
            </button>
            <button onClick={() => scrollToSection("how-it-works")} className="text-sm text-white/70 hover:text-white transition">
              {t("header.howItWorks")}
            </button>
            <button onClick={() => scrollToSection("pricing")} className="text-sm text-white/70 hover:text-white transition">
              {t("header.pricing")}
            </button>
            <button onClick={() => scrollToSection("faq")} className="text-sm text-white/70 hover:text-white transition">
              {t("header.faq")}
            </button>
          </nav>

          <div className="hidden md:flex items-center gap-6">
            <LangToggle />
            <a
              href={appUrl}
              className="inline-block px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium text-sm transition"
            >
              {t("header.cta")}
            </a>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <LangToggle />
            <button className="p-2" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 pt-4 border-t border-white/10 bg-[#0a0a0a] -mx-6 px-6 rounded-b-xl shadow-xl">
            <nav className="flex flex-col gap-4">
              <button onClick={() => scrollToSection("features")} className="text-left text-white/70 hover:text-white transition">
                {t("header.features")}
              </button>
              <button onClick={() => scrollToSection("how-it-works")} className="text-left text-white/70 hover:text-white transition">
                {t("header.howItWorks")}
              </button>
              <button onClick={() => scrollToSection("pricing")} className="text-left text-white/70 hover:text-white transition">
                {t("header.pricing")}
              </button>
              <button onClick={() => scrollToSection("faq")} className="text-left text-white/70 hover:text-white transition">
                {t("header.faq")}
              </button>
              <a href={appUrl} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium text-sm transition w-full mt-2 text-center block">
                {t("header.cta")}
              </a>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
