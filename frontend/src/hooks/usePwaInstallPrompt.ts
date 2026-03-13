import { useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PWA_DISMISSED_KEY = "@tsspro_ai/pwa_dismissed_at";
const DISMISS_DAYS = 7;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const iosStandalone = (navigator as { standalone?: boolean }).standalone;
    setIsInstalled(standalone || !!iosStandalone);

    AsyncStorage.getItem(PWA_DISMISSED_KEY).then((stored) => {
      if (stored) {
        const ts = parseInt(stored, 10);
        if (!isNaN(ts) && Date.now() < ts) setDismissedUntil(ts);
      }
    });

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsInstallable(false);
    return outcome === "accepted";
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    setDismissedUntil(until);
    setIsInstallable(false);
    AsyncStorage.setItem(PWA_DISMISSED_KEY, String(until));
  }, []);

  const shouldShow =
    isInstallable && !isInstalled && (dismissedUntil == null || Date.now() > dismissedUntil);

  return { shouldShow, promptInstall, dismiss };
}
