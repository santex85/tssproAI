import { useCallback, useState } from "react";
import { Platform } from "react-native";
import * as Sharing from "expo-sharing";
import { SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT } from "../components/InsightShareCard";
import type { RefObject } from "react";
import type { View } from "react-native";

export function useCaptureAndShare(cardRef: RefObject<View | null>): {
  captureAndShare: () => Promise<void>;
  isSharing: boolean;
} {
  const [isSharing, setIsSharing] = useState(false);

  const captureAndShare = useCallback(async () => {
    if (!cardRef.current) return;
    setIsSharing(true);
    try {
      const { captureRef } = require("react-native-view-shot");
      await new Promise((r) => setTimeout(r, 150));
      if (Platform.OS === "web") {
        const dataUri = await captureRef(cardRef.current, {
          format: "png",
          result: "data-uri",
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
        });
        const link = document.createElement("a");
        link.href = dataUri;
        link.download = "tsspro-insight.png";
        link.click();
      } else {
        const uri = await captureRef(cardRef.current, {
          format: "png",
          result: "tmpfile",
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
        });
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await new Promise((r) => setTimeout(r, 500));
          await Sharing.shareAsync(uri, {
            mimeType: "image/png",
            dialogTitle: "Share",
          });
        }
      }
    } catch (_) {
      // Caller may show error via toast or alert if needed
    } finally {
      setIsSharing(false);
    }
  }, [cardRef]);

  return { captureAndShare, isSharing };
}
