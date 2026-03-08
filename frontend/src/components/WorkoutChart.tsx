import React from "react";

/** Props passed through to LineChart from react-native-gifted-charts */
interface WorkoutChartProps {
  data: Array<{ value: number; label?: string }>;
  width: number;
  height: number;
  color: string;
  thickness?: number;
  hideDataPoints?: boolean;
  yAxisColor?: string;
  xAxisColor?: string;
  noOfSections?: number;
  yAxisLabelWidth?: number;
  xAxisLabelTextStyle?: { color?: string; fontSize?: number };
  yAxisTextStyle?: { color?: string; fontSize?: number };
}

/**
 * Wrapper around LineChart that defers loading react-native-gifted-charts
 * until first render. Avoids "Cannot access 'M' before initialization"
 * when DashboardScreen loads (module init order / circular deps).
 */
export function WorkoutChart(props: WorkoutChartProps) {
  const { LineChart } = require("react-native-gifted-charts");
  return <LineChart {...props} />;
}
