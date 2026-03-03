import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  useWindowDimensions,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LineChart, BarChart, PieChart } from "react-native-gifted-charts";
import {
  getAnalyticsOverview,
  getAnalyticsSleep,
  getAnalyticsWorkouts,
  getAnalyticsNutrition,
  postAnalyticsInsight,
  type AnalyticsOverview,
  type AnalyticsSleepResponse,
  type AnalyticsWorkoutsResponse,
  type AnalyticsNutritionResponse,
} from "../api/client";
import { useTheme } from "../theme";
import { useTranslation } from "../i18n";
import { PremiumGateModal } from "../components/PremiumGateModal";

const TAB_KEYS = ["overview", "sleep", "training", "nutrition"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const CHART_HEIGHT = 220;
const DAYS_DEFAULT = 30;

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatPeriodRange(fromIso: string, toIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + "T12:00:00");
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  return `${fmt(fromIso)} – ${fmt(toIso)}`;
}

export function AnalyticsScreen({ onClose, onOpenPricing }: { onClose: () => void; onOpenPricing?: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [premiumGateVisible, setPremiumGateVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [days, setDays] = useState(DAYS_DEFAULT);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [sleepData, setSleepData] = useState<AnalyticsSleepResponse | null>(null);
  const [workoutsData, setWorkoutsData] = useState<AnalyticsWorkoutsResponse | null>(null);
  const [nutritionData, setNutritionData] = useState<AnalyticsNutritionResponse | null>(null);
  const [loading, setLoading] = useState<string | null>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [insightModalVisible, setInsightModalVisible] = useState(false);
  const [insightQuestion, setInsightQuestion] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightText, setInsightText] = useState("");
  const [insightPayload, setInsightPayload] = useState<{ chartType: TabKey; data: Record<string, unknown> } | null>(null);
  const { width: screenWidth, height: windowHeight } = useWindowDimensions();

  const loadOverview = useCallback(async () => {
    try {
      const res = await getAnalyticsOverview(undefined, undefined, days);
      setOverview(res);
    } catch {
      setOverview(null);
    }
  }, [days]);

  const loadSleep = useCallback(async () => {
    try {
      const res = await getAnalyticsSleep(undefined, undefined, days);
      setSleepData(res);
    } catch {
      setSleepData(null);
    }
  }, [days]);

  const loadWorkouts = useCallback(async () => {
    try {
      const res = await getAnalyticsWorkouts(undefined, undefined, days);
      setWorkoutsData(res);
    } catch {
      setWorkoutsData(null);
    }
  }, [days]);

  const loadNutrition = useCallback(async () => {
    try {
      const res = await getAnalyticsNutrition(undefined, undefined, days);
      setNutritionData(res);
    } catch {
      setNutritionData(null);
    }
  }, [days]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoading(activeTab);
    try {
      await Promise.all([loadOverview(), loadSleep(), loadWorkouts(), loadNutrition()]);
    } finally {
      setRefreshing(false);
      setLoading(null);
    }
  }, [activeTab, loadOverview, loadSleep, loadWorkouts, loadNutrition]);

  React.useEffect(() => {
    setLoading(activeTab);
    if (activeTab === "overview") loadOverview().finally(() => setLoading(null));
    else if (activeTab === "sleep") loadSleep().finally(() => setLoading(null));
    else if (activeTab === "training") loadWorkouts().finally(() => setLoading(null));
    else if (activeTab === "nutrition") loadNutrition().finally(() => setLoading(null));
  }, [activeTab, days, loadOverview, loadSleep, loadWorkouts, loadNutrition]);

  const requestInsight = useCallback(
    async (chartType: TabKey, data: Record<string, unknown>) => {
      setInsightLoading(true);
      setInsightText("");
      try {
        const res = await postAnalyticsInsight(chartType, data, insightQuestion || undefined);
        setInsightText(res.insight);
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("errors.requestError");
        if ((msg.includes("403") || msg.includes("Premium")) && onOpenPricing) {
          setPremiumGateVisible(true);
        } else {
          setInsightText(msg);
        }
      } finally {
        setInsightLoading(false);
      }
    },
    [insightQuestion, t]
  );

  const openInsight = useCallback(() => {
    setInsightModalVisible(true);
    setInsightText("");
    setInsightLoading(true);
    const chartTypeForApi = activeTab === "training" ? "workouts" : activeTab;
    if (activeTab === "overview" && overview) {
      setInsightPayload({ chartType: activeTab, data: overview });
      requestInsight(chartTypeForApi, overview);
    } else if (activeTab === "sleep" && sleepData) {
      setInsightPayload({ chartType: activeTab, data: sleepData });
      requestInsight(chartTypeForApi, sleepData);
    } else if (activeTab === "training" && workoutsData) {
      setInsightPayload({ chartType: activeTab, data: workoutsData });
      requestInsight(chartTypeForApi, workoutsData);
    } else if (activeTab === "nutrition" && nutritionData) {
      setInsightPayload({ chartType: activeTab, data: nutritionData });
      requestInsight(chartTypeForApi, nutritionData);
    } else {
      setInsightPayload(null);
    }
  }, [activeTab, overview, sleepData, workoutsData, nutritionData, requestInsight]);

  const sendInsightQuestion = useCallback(() => {
    if (!insightPayload) return;
    const chartTypeForApi = insightPayload.chartType === "training" ? "workouts" : insightPayload.chartType;
    requestInsight(chartTypeForApi, insightPayload.data, insightQuestion || undefined);
  }, [insightPayload, insightQuestion, requestInsight]);

  const styles = makeStyles(colors);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{t("analytics.title")}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Text style={[styles.closeBtn, { color: colors.primary }]}>{t("common.close")}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.surfaceBorder }]}>
        {TAB_KEYS.map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, activeTab === key && styles.tabActive]}
            onPress={() => setActiveTab(key)}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === key ? colors.primary : colors.textMuted },
              ]}
            >
              {t(`analytics.${key}` as "analytics.overview")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {loading === activeTab ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {activeTab === "overview" && (
              <OverviewSection overview={overview} colors={colors} styles={styles} />
            )}
            {activeTab === "sleep" && (
              <SleepSection data={sleepData} colors={colors} styles={styles} screenWidth={screenWidth} />
            )}
            {activeTab === "training" && (
              <TrainingSection
                data={workoutsData}
                colors={colors}
                styles={styles}
                screenWidth={screenWidth}
              />
            )}
            {activeTab === "nutrition" && (
              <NutritionSection
                data={nutritionData}
                colors={colors}
                styles={styles}
                screenWidth={screenWidth}
              />
            )}

            <TouchableOpacity
              style={[styles.askAiBtn, { backgroundColor: colors.primary }]}
              onPress={openInsight}
              disabled={
                (activeTab === "overview" && !overview) ||
                (activeTab === "sleep" && !sleepData?.items?.length) ||
                (activeTab === "training" && !workoutsData?.daily?.length && !workoutsData?.load?.length) ||
                (activeTab === "nutrition" && !nutritionData?.items?.length)
              }
            >
              <Text style={[styles.askAiBtnText, { color: colors.primaryText }]}>
                {t("analytics.askAi")}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal
        visible={insightModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setInsightModalVisible(false)}
      >
        <Pressable style={[styles.modalOverlay, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={() => setInsightModalVisible(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.glassBg, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: colors.borderRadiusLg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t("analytics.askAi")}
              </Text>
              <TouchableOpacity onPress={() => setInsightModalVisible(false)}>
                <Text style={{ color: colors.primary }}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t("analytics.insightPlaceholder")}
              placeholderTextColor={colors.textMuted}
              value={insightQuestion}
              onChangeText={setInsightQuestion}
              multiline
            />
            <TouchableOpacity
              style={[styles.askAiBtn, { backgroundColor: colors.primary, marginBottom: 12 }]}
              onPress={sendInsightQuestion}
              disabled={insightLoading || !insightPayload}
            >
              <Text style={[styles.askAiBtnText, { color: colors.primaryText }]}>
                {insightLoading ? t("analytics.loadingInsight") : t("analytics.getAnswer")}
              </Text>
            </TouchableOpacity>
            {insightLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            ) : (
              insightText !== "" && (
                <ScrollView
                  style={{ maxHeight: Platform.OS === "web" ? 320 : windowHeight * 0.35 }}
                  contentContainerStyle={{ paddingBottom: 16 }}
                  showsVerticalScrollIndicator
                >
                  <Text style={[styles.insightText, { color: colors.text }]}>{insightText}</Text>
                </ScrollView>
              )
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <PremiumGateModal
        visible={premiumGateVisible}
        onClose={() => setPremiumGateVisible(false)}
        onUpgrade={() => { setPremiumGateVisible(false); onOpenPricing?.(); }}
      />
    </SafeAreaView>
  );
}

function OverviewSection({
  overview,
  colors,
  styles,
}: {
  overview: AnalyticsOverview | null;
  colors: Record<string, string>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  if (!overview) {
    return (
      <Text style={[styles.noData, { color: colors.textMuted }]}>{t("analytics.noData")}</Text>
    );
  }
  const { ctl_atl_tsb, goals } = overview;
  return (
    <View style={styles.section}>
      <View style={styles.cardRow}>
        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: colors.borderRadiusLg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={[styles.cardValue, { color: colors.text }]}>
            {overview.avg_sleep_hours != null ? `${overview.avg_sleep_hours} ч` : "—"}
          </Text>
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>{t("analytics.avgSleep")}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: colors.borderRadiusLg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={[styles.cardValue, { color: colors.text }]}>{overview.workout_count}</Text>
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>
            {t("analytics.workoutsCount")}
          </Text>
        </View>
      </View>
      <View style={styles.cardRow}>
        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: colors.borderRadiusLg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={[styles.cardValue, { color: colors.text }]}>{overview.total_tss}</Text>
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>{t("analytics.totalTss")}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: colors.borderRadiusLg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={[styles.cardValue, { color: colors.text }]}>
            {overview.avg_calories_per_day != null ? Math.round(overview.avg_calories_per_day) : "—"}
          </Text>
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>
            {t("analytics.caloriesPerDay")}
          </Text>
        </View>
      </View>
      {ctl_atl_tsb && (
        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: colors.borderRadiusLg, marginTop: 8 }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={[styles.cardLabel, { color: colors.textMuted, marginBottom: 4 }]}>
            {t("fitness.title")}
          </Text>
          <Text style={[styles.cardValue, { color: colors.text, fontSize: 16 }]}>
            CTL {Number(ctl_atl_tsb.ctl).toFixed(1)} · ATL {Number(ctl_atl_tsb.atl).toFixed(1)} · TSB {Number(ctl_atl_tsb.tsb).toFixed(1)}
          </Text>
        </View>
      )}
      {goals && Object.keys(goals).length > 0 && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Цели: {goals.calorie_goal != null ? `Ккал ${goals.calorie_goal}` : ""}
          {goals.protein_goal != null ? ` · Белок ${goals.protein_goal} г` : ""}
        </Text>
      )}
    </View>
  );
}

function SleepSection({
  data,
  colors,
  styles,
  screenWidth,
}: {
  data: AnalyticsSleepResponse | null;
  colors: Record<string, string>;
  styles: ReturnType<typeof makeStyles>;
  screenWidth: number;
}) {
  const { t } = useTranslation();
  if (!data?.items?.length) {
    return (
      <Text style={[styles.noData, { color: colors.textMuted }]}>{t("analytics.noData")}</Text>
    );
  }
  const lineData = data.items
    .filter((i) => i.sleep_hours != null)
    .map((i) => ({ value: i.sleep_hours!, label: formatShortDate(i.date) }));
  if (lineData.length === 0) {
    return (
      <Text style={[styles.noData, { color: colors.textMuted }]}>{t("analytics.noData")}</Text>
    );
  }
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("wellness.sleep")} (ч)</Text>
      <View style={[styles.chartWrap, { height: CHART_HEIGHT }]}>
        <LineChart
          data={lineData}
          width={Math.max(screenWidth - 48, lineData.length * 24)}
          height={CHART_HEIGHT - 24}
          color={colors.primary}
          thickness={2}
          hideDataPoints={lineData.length > 14}
          yAxisColor={colors.surfaceBorder}
          xAxisColor={colors.surfaceBorder}
          noOfSections={4}
          maxValue={10}
          yAxisLabelWidth={28}
          xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
          yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        />
      </View>
    </View>
  );
}

function TrainingSection({
  data,
  colors,
  styles,
  screenWidth,
}: {
  data: AnalyticsWorkoutsResponse | null;
  colors: Record<string, string>;
  styles: ReturnType<typeof makeStyles>;
  screenWidth: number;
}) {
  const { t } = useTranslation();
  if (!data) {
    return (
      <Text style={[styles.noData, { color: colors.textMuted }]}>{t("analytics.noData")}</Text>
    );
  }
  const hasDaily = data.daily?.length;
  const hasLoad = data.load?.length;
  const barData = (data.daily || []).map((d) => ({
    value: d.tss,
    label: formatShortDate(d.date),
    frontColor: colors.primary,
  }));
  const loadCtl = (data.load || []).filter((l) => l.ctl != null).map((l) => ({
    value: l.ctl!,
    label: formatShortDate(l.date),
  }));
  return (
    <View style={styles.section}>
      {hasDaily > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>TSS по дням</Text>
          <View style={[styles.chartWrap, { height: CHART_HEIGHT }]}>
            <BarChart
              data={barData}
              width={Math.max(screenWidth - 48, barData.length * 20)}
              height={CHART_HEIGHT - 24}
              barWidth={Math.min(20, (screenWidth - 80) / Math.max(barData.length, 1))}
              color={colors.primary}
              noOfSections={4}
              yAxisColor={colors.surfaceBorder}
              xAxisColor={colors.surfaceBorder}
              xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
            />
          </View>
        </>
      )}
      {loadCtl.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}>
            {t("analytics.loadCtl")} / {t("analytics.loadAtl")}
          </Text>
          <View style={[styles.chartWrap, { height: CHART_HEIGHT }]}>
            <LineChart
              data={loadCtl}
              width={Math.max(screenWidth - 48, loadCtl.length * 24)}
              height={CHART_HEIGHT - 24}
              color={colors.primary}
              thickness={2}
              hideDataPoints={loadCtl.length > 14}
              yAxisColor={colors.surfaceBorder}
              xAxisColor={colors.surfaceBorder}
              noOfSections={4}
              yAxisLabelWidth={28}
              xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
            />
          </View>
        </>
      )}
      {!hasDaily && !hasLoad && (
        <Text style={[styles.noData, { color: colors.textMuted }]}>{t("analytics.noData")}</Text>
      )}
    </View>
  );
}

function NutritionSection({
  data,
  colors,
  styles,
  screenWidth,
}: {
  data: AnalyticsNutritionResponse | null;
  colors: Record<string, string>;
  styles: ReturnType<typeof makeStyles>;
  screenWidth: number;
}) {
  const { t } = useTranslation();
  if (!data?.items?.length) {
    return (
      <Text style={[styles.noData, { color: colors.textMuted }]}>{t("analytics.noData")}</Text>
    );
  }
  const barData = data.items.map((i) => ({
    value: i.calories,
    label: formatShortDate(i.date),
    frontColor: colors.primary,
  }));
  const totalProtein = data.items.reduce((s, i) => s + i.protein_g, 0);
  const totalFat = data.items.reduce((s, i) => s + i.fat_g, 0);
  const totalCarbs = data.items.reduce((s, i) => s + i.carbs_g, 0);
  const total = totalProtein + totalFat + totalCarbs || 1;
  const pieData = [
    { value: totalProtein, color: colors.primary },
    { value: totalFat, color: colors.accent },
    { value: totalCarbs, color: colors.success },
  ].filter((d) => d.value > 0);

  const aggregatedMicronutrients: Record<string, number> = {};
  for (const item of data.items) {
    if (!item.extended_nutrients) continue;
    for (const [key, value] of Object.entries(item.extended_nutrients)) {
      if (typeof value === "number") {
        aggregatedMicronutrients[key] = (aggregatedMicronutrients[key] ?? 0) + value;
      }
    }
  }
  const micronutrientEntries = Object.entries(aggregatedMicronutrients)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: Math.round(value * 10) / 10 }));

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {t("nutrition.caloriesLabel")} по дням
      </Text>
      <View style={[styles.chartWrap, { height: CHART_HEIGHT }]}>
        <BarChart
          data={barData}
          width={Math.max(screenWidth - 48, barData.length * 20)}
          height={CHART_HEIGHT - 24}
          barWidth={Math.min(20, (screenWidth - 80) / Math.max(barData.length, 1))}
          color={colors.primary}
          noOfSections={4}
          yAxisColor={colors.surfaceBorder}
          xAxisColor={colors.surfaceBorder}
          xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
          yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        />
      </View>
      {pieData.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}>
            Б / Ж / У за период
          </Text>
          <Text style={[styles.periodSubtitle, { color: colors.textMuted }]}>
            {t("analytics.forPeriod")} {formatPeriodRange(data.from_date, data.to_date)}
          </Text>
          <View style={[styles.chartWrap, { height: 160 }]}>
            <PieChart
              data={pieData}
              donut
              radius={60}
              innerRadius={36}
              centerLabelComponent={() => (
                <Text style={[styles.donutCenterLabel, { color: colors.text }]}>
                  {data.items.length} {t("analytics.days")}
                </Text>
              )}
            />
          </View>
          <View style={styles.legendWrap}>
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.legendLabel, { color: colors.text }]}>{t("nutrition.proteinLabel")}</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.legendLabel, { color: colors.text }]}>{t("nutrition.fatLabel")}</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.legendLabel, { color: colors.text }]}>{t("nutrition.carbsLabel")}</Text>
            </View>
          </View>
        </>
      )}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>
        {t("nutrition.micronutrients")}
      </Text>
      <Text style={[styles.periodSubtitle, { color: colors.textMuted }]}>
        {t("analytics.forPeriod")} {formatPeriodRange(data.from_date, data.to_date)}
      </Text>
      {micronutrientEntries.length > 0 ? (
        <View style={styles.micronutrientsBlock}>
          {micronutrientEntries.map(({ key, value }) => {
            const labelKey = `nutrition.micronutrientLabels.${key}`;
            const label = t(labelKey);
            return (
              <View key={key} style={styles.micronutrientRow}>
                <Text style={styles.micronutrientLabel}>
                  {label === labelKey ? key : label}
                </Text>
                <Text style={styles.micronutrientValue}>{value}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.noData, { color: colors.textMuted, paddingVertical: 12 }]}>
          {t("analytics.micronutrientsNoData")}
        </Text>
      )}
    </View>
  );
}

function makeStyles(colors: Record<string, string>) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    title: { fontSize: 20, fontWeight: "700" },
    closeBtn: { fontSize: 16 },
    tabs: {
      flexDirection: "row",
      borderBottomWidth: 1,
      paddingHorizontal: 8,
    },
    tab: { paddingVertical: 12, paddingHorizontal: 12 },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabText: { fontSize: 14 },
    scroll: { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: 32 },
    centered: { paddingVertical: 48, alignItems: "center" },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
    periodSubtitle: { fontSize: 12, marginBottom: 8 },
    donutCenterLabel: { fontSize: 14, fontWeight: "700" },
    legendWrap: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 8, marginBottom: 8 },
    legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendLabel: { fontSize: 13 },
    cardRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
    card: {
      flex: 1,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
    },
    cardValue: { fontSize: 20, fontWeight: "700" },
    cardLabel: { fontSize: 12, marginTop: 4 },
    chartWrap: { marginVertical: 8 },
    noData: { textAlign: "center", paddingVertical: 24 },
    hint: { fontSize: 12, marginTop: 8 },
    askAiBtn: {
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: "center",
      marginTop: 16,
    },
    askAiBtnText: { fontSize: 16, fontWeight: "600" },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalContent: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 32,
      minHeight: 200,
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    modalTitle: { fontSize: 18, fontWeight: "600" },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      minHeight: 44,
      marginBottom: 12,
    },
    insightText: { fontSize: 14, lineHeight: 24, paddingVertical: 4 },
    micronutrientsBlock: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder },
    micronutrientRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
    micronutrientLabel: { fontSize: 13, color: colors.textMuted },
    micronutrientValue: { fontSize: 13, color: colors.text },
  });
}
