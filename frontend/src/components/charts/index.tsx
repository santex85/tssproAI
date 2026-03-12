import React, { useEffect, useState } from "react";

/**
 * Shared promise to prevent multiple concurrent imports of react-native-gifted-charts.
 * Deferred via requestAnimationFrame to avoid TDZ "Cannot access 'M' before initialization".
 */
let chartsPromise: Promise<typeof import("react-native-gifted-charts")> | null = null;

function loadCharts(): Promise<typeof import("react-native-gifted-charts")> {
  if (chartsPromise) return chartsPromise;
  chartsPromise = new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      import("react-native-gifted-charts").then(resolve).catch(reject);
    });
  });
  return chartsPromise;
}

export function LazyLineChart(props: Record<string, unknown>) {
  const [Chart, setChart] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    loadCharts()
      .then((m) => setChart(() => m.LineChart))
      .catch(() => {});
  }, []);
  if (!Chart) return null;
  return <Chart {...props} />;
}

export function LazyBarChart(props: Record<string, unknown>) {
  const [Chart, setChart] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    loadCharts()
      .then((m) => setChart(() => m.BarChart))
      .catch(() => {});
  }, []);
  if (!Chart) return null;
  return <Chart {...props} />;
}

export function LazyPieChart(props: Record<string, unknown>) {
  const [Chart, setChart] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    loadCharts()
      .then((m) => setChart(() => m.PieChart))
      .catch(() => {});
  }, []);
  if (!Chart) return null;
  return <Chart {...props} />;
}
