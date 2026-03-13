import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LazyLineChart } from "../charts";
import {
  getAnalyticsWorkouts,
  type WorkoutFitness,
  type WellnessDay,
  type AnalyticsWorkoutsResponse,
} from "../../api/client";
import { useTheme } from "../../theme";
import { useTranslation } from "../../i18n";

const SPARKLINE_HEIGHT = 48;
const SPARKLINE_WIDTH = 80;
const DAYS_LOAD = 30;

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function PerformanceView({
  workoutFitness,
  effectiveWellnessToday,
  onOpenIntervals,
  onSyncClick,
  syncLoading,
}: {
  workoutFitness: WorkoutFitness | null;
  effectiveWellnessToday: WellnessDay | null;
  onOpenIntervals?: () => void;
  onSyncClick?: () => Promise<void>;
  syncLoading: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [workoutsData, setWorkoutsData] = useState<AnalyticsWorkoutsResponse | null>(null);
  const [loadDataLoading, setLoadDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoadDataLoading(true);
    try {
      const toDate = daysAgoIso(0);
      const fromDate = daysAgoIso(DAYS_LOAD);
      const res = await getAnalyticsWorkouts(fromDate, toDate, DAYS_LOAD);
      setWorkoutsData(res);
    } catch {
      setWorkoutsData(null);
    } finally {
      setLoadDataLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    if (!onSyncClick) return;
    try {
      await onSyncClick();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.syncFailed"));
    }
  };

  const showCtlInfo = () => {
    const msg = t("fitness.ctlTooltip");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`CTL\n\n${msg}`);
    } else {
      Alert.alert("CTL", msg);
    }
  };
  const showAtlInfo = () => {
    const msg = t("fitness.atlTooltip");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`ATL\n\n${msg}`);
    } else {
      Alert.alert("ATL", msg);
    }
  };
  const showTsbInfo = () => {
    const msg = t("fitness.tsbTooltip");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`TSB\n\n${msg}`);
    } else {
      Alert.alert("TSB", msg);
    }
  };

  const hasFitness =
    workoutFitness ||
    (effectiveWellnessToday?.ctl != null || effectiveWellnessToday?.atl != null || effectiveWellnessToday?.tsb != null);

  const ctl = workoutFitness?.ctl ?? effectiveWellnessToday?.ctl ?? null;
  const atl = workoutFitness?.atl ?? effectiveWellnessToday?.atl ?? null;
  const tsb = workoutFitness?.tsb ?? effectiveWellnessToday?.tsb ?? null;
  const dateLabel = workoutFitness?.date ?? null;
  const fromWellness = !workoutFitness && (effectiveWellnessToday?.ctl != null || effectiveWellnessToday?.atl != null || effectiveWellnessToday?.tsb != null);

  const loadArr = workoutsData?.load ?? [];
  const loadComplete = loadArr.filter((l) => l.ctl != null && l.atl != null && l.tsb != null);
  const ctlData = loadComplete.map((l) => ({ value: l.ctl!, label: formatShortDate(l.date) }));
  const atlData = loadComplete.map((l) => ({ value: l.atl!, label: formatShortDate(l.date) }));
  const tsbData = loadComplete.map((l) => ({ value: l.tsb!, label: formatShortDate(l.date) }));

  const chartWidth = Math.max(SPARKLINE_WIDTH, Math.min(screenWidth - 200, (ctlData.length || 1) * 12));

  return (
    <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: 16 }]}>
      <View style={[styles.cardHeader, { borderBottomColor: colors.surfaceBorder }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t("fitness.title")}</Text>
        <View style={styles.headerActions}>
          {onOpenIntervals ? (
            <TouchableOpacity onPress={onOpenIntervals} style={[styles.intervalsBtn, { borderColor: colors.glassBorder }]} accessibilityRole="button">
              <Text style={[styles.intervalsBtnText, { color: colors.primary }]}>Intervals.icu</Text>
            </TouchableOpacity>
          ) : null}
          {onSyncClick ? (
            <TouchableOpacity
              onPress={handleSync}
              disabled={syncLoading}
              style={[styles.refreshBtn, syncLoading && styles.refreshBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t("fitness.sync")}
            >
              {syncLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {hasFitness ? (
        <>
          <View style={styles.metricsGrid}>
            <View style={styles.metricRow}>
              <View style={styles.metricLabelRow}>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>CTL</Text>
                <TouchableOpacity onPress={showCtlInfo} hitSlop={12} style={styles.infoBtn} accessibilityRole="button" accessibilityLabel={t("common.alerts.info")}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: colors.text }]}>{ctl != null ? ctl.toFixed(1) : "—"}</Text>
                {loadDataLoading ? (
                  <View style={[styles.sparklinePlaceholder, { width: chartWidth, backgroundColor: colors.skeleton }]} />
                ) : ctlData.length > 0 ? (
                  <View style={[styles.sparklineWrap, { width: chartWidth, maxWidth: "100%" }]}>
                    <LazyLineChart
                      data={ctlData}
                      width={chartWidth}
                      height={SPARKLINE_HEIGHT - 8}
                      color={colors.primary}
                      thickness={1.5}
                      hideDataPoints
                      hideRules
                      hideYAxisText
                      yAxisColor="transparent"
                      xAxisColor="transparent"
                      noOfSections={1}
                      yAxisLabelWidth={0}
                      spacing={Math.max(2, chartWidth / Math.max(ctlData.length, 1))}
                    />
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricLabelRow}>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>ATL</Text>
                <TouchableOpacity onPress={showAtlInfo} hitSlop={12} style={styles.infoBtn} accessibilityRole="button" accessibilityLabel={t("common.alerts.info")}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: colors.text }]}>{atl != null ? atl.toFixed(1) : "—"}</Text>
                {loadDataLoading ? (
                  <View style={[styles.sparklinePlaceholder, { width: chartWidth, backgroundColor: colors.skeleton }]} />
                ) : atlData.length > 0 ? (
                  <View style={[styles.sparklineWrap, { width: chartWidth, maxWidth: "100%" }]}>
                    <LazyLineChart
                      data={atlData}
                      width={chartWidth}
                      height={SPARKLINE_HEIGHT - 8}
                      color={colors.accent}
                      thickness={1.5}
                      hideDataPoints
                      hideRules
                      hideYAxisText
                      yAxisColor="transparent"
                      xAxisColor="transparent"
                      noOfSections={1}
                      yAxisLabelWidth={0}
                      spacing={Math.max(2, chartWidth / Math.max(atlData.length, 1))}
                    />
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricLabelRow}>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>TSB</Text>
                <TouchableOpacity onPress={showTsbInfo} hitSlop={12} style={styles.infoBtn} accessibilityRole="button" accessibilityLabel={t("common.alerts.info")}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: colors.text }]}>{tsb != null ? tsb.toFixed(1) : "—"}</Text>
                {loadDataLoading ? (
                  <View style={[styles.sparklinePlaceholder, { width: chartWidth, backgroundColor: colors.skeleton }]} />
                ) : tsbData.length > 0 ? (
                  <View style={[styles.sparklineWrap, { width: chartWidth, maxWidth: "100%" }]}>
                    <LazyLineChart
                      data={tsbData}
                      width={chartWidth}
                      height={SPARKLINE_HEIGHT - 8}
                      color={tsb != null && tsb >= 0 ? colors.success : colors.danger}
                      thickness={1.5}
                      hideDataPoints
                      hideRules
                      hideYAxisText
                      yAxisColor="transparent"
                      xAxisColor="transparent"
                      noOfSections={1}
                      yAxisLabelWidth={0}
                      spacing={Math.max(2, chartWidth / Math.max(tsbData.length, 1))}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {loadComplete.length > 0 && (
            <Text style={[styles.periodCaption, { color: colors.textMuted }]}>
              {formatShortDate(loadComplete[0].date)} — {formatShortDate(loadComplete[loadComplete.length - 1].date)}
            </Text>
          )}

          {dateLabel ? (
            <Text style={[styles.dateCaption, { color: colors.textMuted }]}>
              {t("fitness.dateLabel")} {dateLabel}
            </Text>
          ) : null}
          {fromWellness ? (
            <Text style={[styles.dateCaption, styles.fromWellness, { color: colors.textMuted }]}>
              {t("fitness.fromWellness")}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[styles.placeholder, { color: colors.textMuted }]}>{t("fitness.placeholder")}</Text>
      )}

      <Text style={[styles.hint, { color: colors.textMuted, marginTop: 12 }]}>{t("fitness.hint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
    padding: 20,
    borderWidth: 1,
    ...(Platform.OS === "web" ? { backdropFilter: "blur(20px)" } : {}),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  intervalsBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  intervalsBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  refreshBtn: {
    padding: 8,
  },
  refreshBtnDisabled: {
    opacity: 0.7,
  },
  metricsGrid: {
    gap: 16,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  infoBtn: {
    padding: 4,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const, minWidth: 28, minHeight: 28 } : {}),
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1,
    minWidth: 0,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 44,
  },
  sparklineWrap: {
    height: SPARKLINE_HEIGHT,
    overflow: "hidden",
    maxWidth: "100%",
  },
  periodCaption: {
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  sparklinePlaceholder: {
    height: SPARKLINE_HEIGHT - 8,
    borderRadius: 4,
  },
  dateCaption: {
    fontSize: 12,
    marginTop: 4,
  },
  fromWellness: {
    fontStyle: "italic",
  },
  placeholder: {
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
  },
});
