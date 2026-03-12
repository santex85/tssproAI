import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getWellness, createOrUpdateWellness, deleteWellness, type WellnessDay } from "../api/client";
import { useTranslation } from "../i18n";

function Calendar(props: Record<string, unknown>) {
  const Component = require("react-native-calendars").Calendar;
  return <Component {...props} />;
}

function getTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CALENDAR_THEME = {
  backgroundColor: "transparent",
  calendarBackground: "transparent",
  textSectionTitleColor: "#94a3b8",
  selectedDayBackgroundColor: "#38bdf8",
  selectedDayTextColor: "#0f172a",
  todayTextColor: "#38bdf8",
  dayTextColor: "#e2e8f0",
  textDisabledColor: "#475569",
  dotColor: "#38bdf8",
  selectedDotColor: "#0f172a",
  arrowColor: "#38bdf8",
  monthTextColor: "#e2e8f0",
  textDayFontWeight: "500" as const,
  textMonthFontWeight: "700" as const,
};

export function WellnessScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const today = getTodayLocal();
  const [selectedDay, setSelectedDay] = useState(today);
  const [sleepHours, setSleepHours] = useState("");
  const [rhr, setRhr] = useState("");
  const [hrv, setHrv] = useState("");
  const [loaded, setLoaded] = useState<WellnessDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [trendData, setTrendData] = useState<WellnessDay[]>([]);

  const loadDay = useCallback(async (dateStr: string) => {
    setLoading(true);
    try {
      const res = await getWellness(dateStr, dateStr);
      const list = res?.items ?? [];
      const day = list.length ? list[0] : null;
      setLoaded(day ?? null);
      setSleepHours(day?.sleep_hours != null ? String(day.sleep_hours) : "");
      setRhr(day?.rhr != null ? String(day.rhr) : "");
      setHrv(day?.hrv != null ? String(day.hrv) : "");
    } catch {
      setLoaded(null);
      setSleepHours("");
      setRhr("");
      setHrv("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDay(selectedDay);
  }, [selectedDay, loadDay]);

  useEffect(() => {
    const from = addDays(today, -6);
    getWellness(from, today).then((res) => setTrendData(res?.items ?? [])).catch(() => setTrendData([]));
  }, [today]);

  const handleSave = async () => {
    const sleep = sleepHours.trim() ? parseFloat(sleepHours) : undefined;
    const rhrVal = rhr.trim() ? parseFloat(rhr) : undefined;
    const hrvVal = hrv.trim() ? parseFloat(hrv) : undefined;
    if (sleep != null && (Number.isNaN(sleep) || sleep < 0 || sleep > 24)) {
      Alert.alert(t("common.error"), t("wellnessScreen.validationSleep"));
      return;
    }
    if (rhrVal != null && (Number.isNaN(rhrVal) || rhrVal < 0 || rhrVal > 200)) {
      Alert.alert(t("common.error"), t("wellnessScreen.validationPulse"));
      return;
    }
    if (hrvVal != null && (Number.isNaN(hrvVal) || hrvVal < 0)) {
      Alert.alert(t("common.error"), t("wellnessScreen.validationHrv"));
      return;
    }
    setSaving(true);
    try {
      await createOrUpdateWellness({
        date: selectedDay,
        sleep_hours: sleep,
        rhr: rhrVal,
        hrv: hrvVal,
      });
      await loadDay(selectedDay);
      Alert.alert(t("wellnessScreen.savedTitle"), t("wellnessScreen.saved"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("wellnessScreen.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const hasWellnessData = loaded && (loaded.sleep_hours != null || loaded.rhr != null || loaded.hrv != null || loaded.weight_kg != null);

  const handleDelete = () => {
    if (!hasWellnessData) return;
    const doDelete = async () => {
      setDeleting(true);
      try {
        await deleteWellness(selectedDay);
        await loadDay(selectedDay);
        const from = addDays(today, -6);
        getWellness(from, today).then((res) => setTrendData(res?.items ?? [])).catch(() => setTrendData([]));
      } catch (e) {
        Alert.alert(t("common.error"), e instanceof Error ? e.message : t("wellnessScreen.saveFailed"));
      } finally {
        setDeleting(false);
      }
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`${t("wellness.deleteWellnessTitle")}\n${t("wellness.deleteWellnessMessage")}`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        t("wellness.deleteWellnessTitle"),
        t("wellness.deleteWellnessMessage"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("wellness.deleteSleepEntryConfirm"), style: "destructive", onPress: doDelete },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
          <Text style={styles.backText}>{t("settings.back")}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t("wellnessScreen.title")}</Text>
        <View style={styles.backBtn} />
      </View>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <Calendar
          current={selectedDay}
          onDayPress={(day) => setSelectedDay(day.dateString)}
          markedDates={{ [selectedDay]: { selected: true } }}
          theme={CALENDAR_THEME}
          style={styles.calendar}
        />
        <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          {trendData.length > 0 ? (
            <View style={styles.trendSection}>
              <Text style={styles.trendTitle}>{t("wellnessScreen.sleepTrendTitle")}</Text>
              <View style={styles.trendChart}>
                {[...trendData].sort((a, b) => a.date.localeCompare(b.date)).map((day) => {
                  const hours = day.sleep_hours ?? 0;
                  const heightPct = Math.min(12, hours) / 12;
                  return (
                    <View key={day.date} style={styles.trendBarWrap}>
                      <View style={[styles.trendBarBg, { height: 80 }]}>
                        <View style={[styles.trendBarFill, { height: `${heightPct * 100}%` }]} />
                      </View>
                      <Text style={styles.trendBarLabel}>
                        {new Date(day.date + "T12:00:00").getDate()}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>{t("wellnessScreen.dataForDate").replace("{date}", selectedDay)}</Text>
          {loading ? (
            <ActivityIndicator size="small" color="#38bdf8" style={styles.loader} />
          ) : (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>{t("wellnessScreen.sleepHoursLabel")}</Text>
                <TextInput
                  style={styles.input}
                  value={sleepHours}
                  onChangeText={setSleepHours}
                  placeholder="e.g. 7.5"
                  placeholderTextColor="#64748b"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t("wellnessScreen.rhrLabel")}</Text>
                <TextInput
                  style={styles.input}
                  value={rhr}
                  onChangeText={setRhr}
                  placeholder="e.g. 52"
                  placeholderTextColor="#64748b"
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>HRV (ms)</Text>
                <TextInput
                  style={styles.input}
                  value={hrv}
                  onChangeText={setHrv}
                  placeholder="e.g. 45"
                  placeholderTextColor="#64748b"
                  keyboardType="number-pad"
                />
              </View>
              {loaded && (loaded.ctl != null || loaded.atl != null || loaded.tsb != null) ? (
                <View style={styles.readOnly}>
                  <Text style={styles.label}>{t("wellnessScreen.loadReadOnly")}</Text>
                  <Text style={styles.hint}>
                    CTL: {loaded.ctl != null ? loaded.ctl.toFixed(1) : "—"} · ATL: {loaded.atl != null ? loaded.atl.toFixed(1) : "—"} · TSB: {loaded.tsb != null ? loaded.tsb.toFixed(1) : "—"}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Text style={styles.saveBtnText}>{t("common.save")}</Text>
                )}
              </TouchableOpacity>
              {hasWellnessData ? (
                <TouchableOpacity
                  style={[styles.deleteBtn, deleting && styles.saveBtnDisabled]}
                  onPress={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.deleteBtnText}>{t("common.delete")}</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0D0D0D" },
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  backBtn: { minWidth: 56 },
  backText: { fontSize: 16, color: "#38bdf8" },
  title: { fontSize: 18, fontWeight: "600", color: "#e2e8f0" },
  calendar: { marginBottom: 8 },
  formScroll: { flex: 1 },
  formContent: { padding: 20, paddingBottom: 40 },
  trendSection: { marginBottom: 24 },
  trendTitle: { fontSize: 14, fontWeight: "600", color: "#94a3b8", marginBottom: 10 },
  trendChart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 100, gap: 4 },
  trendBarWrap: { flex: 1, alignItems: "center" },
  trendBarBg: { width: "100%", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 4, justifyContent: "flex-end", overflow: "hidden" },
  trendBarFill: { backgroundColor: "#38bdf8", borderRadius: 4, minHeight: 2 },
  trendBarLabel: { fontSize: 10, color: "#64748b", marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#e2e8f0", marginBottom: 16 },
  loader: { marginVertical: 20 },
  field: { marginBottom: 16 },
  label: { fontSize: 14, color: "#94a3b8", marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#e2e8f0",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  readOnly: { marginBottom: 16 },
  hint: { fontSize: 14, color: "#94a3b8" },
  saveBtn: {
    backgroundColor: "#38bdf8",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  deleteBtn: {
    backgroundColor: "#dc2626",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  deleteBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
