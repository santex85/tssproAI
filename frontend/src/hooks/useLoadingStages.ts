import { useState, useEffect } from "react";

/**
 * Returns the current loading stage index (0 .. stageCount-1), advancing every intervalMs
 * while isActive is true. Resets to 0 when isActive becomes false.
 */
export function useLoadingStages(
  isActive: boolean,
  stageCount: number,
  intervalMs: number = 1600
): number {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (!isActive || stageCount <= 0) {
      setStageIndex(0);
      return;
    }
    const id = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % stageCount);
    }, intervalMs);
    return () => clearInterval(id);
  }, [isActive, stageCount, intervalMs]);

  if (!isActive) return 0;
  return stageIndex % Math.max(1, stageCount);
}
