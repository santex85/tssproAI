import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const GUIDE_COMPLETED_KEY = "@tsspro_ai/guide_completed";

export function useOnboardingGuide() {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(GUIDE_COMPLETED_KEY).then((stored) => {
      setInitialized(true);
      if (!stored || stored !== "true") {
        setVisible(true);
        setStepIndex(0);
      }
    });
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setStepIndex(0);
    AsyncStorage.setItem(GUIDE_COMPLETED_KEY, "true");
  }, []);

  const showAgain = useCallback(() => {
    setStepIndex(0);
    setVisible(true);
  }, []);

  const goNext = useCallback(() => {
    setStepIndex((prev) => {
      if (prev >= 3) {
        AsyncStorage.setItem(GUIDE_COMPLETED_KEY, "true");
        setVisible(false);
        return 0;
      }
      return prev + 1;
    });
  }, []);

  return {
    visible,
    stepIndex,
    dismiss,
    showAgain,
    goNext,
    initialized,
  };
}
