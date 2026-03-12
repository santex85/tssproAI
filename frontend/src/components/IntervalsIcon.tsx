import React from "react";
import { View, Text, StyleSheet } from "react-native";

/** Intervals.icu logo icon - blue circle with "i" (simplified brand mark). */
export function IntervalsIcon({ size = 24 }: { size?: number }) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.text, { fontSize: size * 0.55 }]}>i</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: "#00a8e8",
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "white",
    fontWeight: "700",
  },
});
