import React from "react";

export function LazyLineChart(props: Record<string, unknown>) {
  const { LineChart } = require("react-native-gifted-charts");
  return <LineChart {...props} />;
}

export function LazyBarChart(props: Record<string, unknown>) {
  const { BarChart } = require("react-native-gifted-charts");
  return <BarChart {...props} />;
}

export function LazyPieChart(props: Record<string, unknown>) {
  const { PieChart } = require("react-native-gifted-charts");
  return <PieChart {...props} />;
}
