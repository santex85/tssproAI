import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
  deleteSleepExtraction,
  reanalyzeSleepExtraction,
  type AthleteProfileResponse,
  type WellnessDay,
  type SleepExtractionSummary,
} from "../../api/client";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useTranslation } from "../../i18n";

export type SleepHistoryEntry = {
  date: string;
  hours: number;
  source: "photo" | "manual";
  extraction?: SleepExtractionSummary;
};

function formatSleepDuration(hours: number, t: (key: string) => string): string {
  const hUnit = t("units.hourShort");
  const mUnit = t("units.minuteShort");
  if (hours <= 0) return `0 ${hUnit}`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m <= 0) return `${h} ${hUnit}`;
  return `${h} ${hUnit} ${m} ${mUnit}`;
}

function formatSleepHistoryDate(dateKey: string): string {
  if (dateKey.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(dateKey.slice(0, 10)))
    return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
  return "—/—";
}

const LIFESTYLE_CARD_RADIUS = 16;

export function LifestyleView({
  effectiveWellnessToday,
  athleteProfile,
  combinedSleepHistory,
  weeklySleepTotal,
  weeklySleepDeficit,
  today,
  onEditPress,
  onEditSleepEntry,
  onDeleteManualSleepEntry,
  onOpenCamera,
  onLoad,
  sleepReanalyzeExtId,
  setSleepReanalyzeExtId,
  sleepReanalyzeCorrection,
  setSleepReanalyzeCorrection,
  sleepReanalyzingId,
}: {
  effectiveWellnessToday: WellnessDay | null;
  athleteProfile: AthleteProfileResponse | null;
  combinedSleepHistory: SleepHistoryEntry[];
  weeklySleepTotal: number;
  weeklySleepDeficit: number;
  today: string;
  onEditPress: () => void;
  onEditSleepEntry: (date: string, extractionId?: number | null) => void;
  onDeleteManualSleepEntry: (date: string) => void;
  onOpenCamera: () => void;
  onLoad: () => void;
  sleepReanalyzeExtId: number | null;
  setSleepReanalyzeExtId: (id: number | null) => void;
  sleepReanalyzeCorrection: string;
  setSleepReanalyzeCorrection: (s: string) => void;
  sleepReanalyzingId: number | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [webMenuEntry, setWebMenuEntry] = useState<SleepHistoryEntry | null>(null);

  const showRhrInfo = () => {
    const msg = t("wellness.rhrTooltip");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`RHR\n\n${msg}`);
    } else {
      Alert.alert("RHR", msg);
    }
  };
  const showHrvInfo = () => {
    const msg = t("wellness.hrvTooltip");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`HRV\n\n${msg}`);
    } else {
      Alert.alert("HRV", msg);
    }
  };

  const handleDeleteSleepEntry = async (extractionId: number) => {
    try {
      await deleteSleepExtraction(extractionId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onLoad();
    } catch (e) {
      const raw = e instanceof Error ? e.message : t("dashboard.deleteFailed");
      let msg = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.detail === "Not Found" || parsed?.detail === "Extraction not found")
          msg = t("common.alerts.recordNotFound");
      } catch {
        if (raw.startsWith("{")) msg = t("common.alerts.serverError");
      }
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.alert(msg);
      } else {
        Alert.alert(t("common.error"), msg);
      }
    }
  };

  const handleReanalyze = async (extractionId: number, correction: string) => {
    if (!correction.trim()) return;
    setSleepReanalyzingId(extractionId);
    try {
      await reanalyzeSleepExtraction(extractionId, correction);
      setSleepReanalyzeExtId(null);
      setSleepReanalyzeCorrection("");
      onLoad();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.reanalyzeFailed"));
    } finally {
      setSleepReanalyzingId(null);
    }
  };

  const confirmDelete = (entry: SleepHistoryEntry) => {
    if (!entry.extraction) return;
    const doDelete = () => handleDeleteSleepEntry(entry.extraction!.id);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`${t("wellness.deleteSleepEntryTitle")}\n${t("wellness.deleteSleepEntryMessage")}`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        t("wellness.deleteSleepEntryTitle"),
        t("wellness.deleteSleepEntryMessage"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("wellness.deleteSleepEntryConfirm"), style: "destructive", onPress: doDelete },
        ]
      );
    }
  };

  const showRowMenu = (entry: SleepHistoryEntry) => {
    if (Platform.OS === "web") {
      setWebMenuEntry(entry);
      return;
    }
    const buttons: { text: string; onPress?: () => void; style?: "cancel" | "destructive" }[] = [
      {
        text: t("wellness.edit"),
        onPress: () => onEditSleepEntry(entry.date, entry.extraction?.id ?? null),
      },
      {
        text: t("wellness.deleteEntry"),
        style: "destructive",
        onPress: () => {
          if (entry.source === "manual") {
            onDeleteManualSleepEntry(entry.date);
          } else {
            confirmDelete(entry);
          }
        },
      },
    ];
    if (entry.source === "photo" && entry.extraction?.can_reanalyze) {
      buttons.push({
        text: t("wellness.reanalyze"),
        onPress: () => {
          setSleepReanalyzeExtId(entry.extraction!.id);
          setSleepReanalyzeCorrection("");
        },
      });
    }
    buttons.push({ text: t("common.cancel"), style: "cancel" });
    Alert.alert("", "", buttons);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderRadius: LIFESTYLE_CARD_RADIUS }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t("wellness.title")}</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onEditPress();
          }}
          style={[styles.editBtn, { borderColor: colors.glassBorder }]}
        >
          <Text style={[styles.editBtnText, { color: colors.primary }]}>{t("wellness.edit")}</Text>
        </TouchableOpacity>
      </View>

      {effectiveWellnessToday?.sleep_hours == null ? (
        <View style={[styles.sleepReminder, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
          <Text style={[styles.sleepReminderText, { color: colors.textMuted }]}>{t("wellness.sleepReminder")}</Text>
          <View style={styles.sleepReminderButtons}>
            <TouchableOpacity style={[styles.sleepReminderBtn, { backgroundColor: colors.inputBg }]} onPress={onEditPress}>
              <Text style={[styles.sleepReminderBtnText, { color: colors.primary }]} numberOfLines={1} ellipsizeMode="tail">
                {t("wellness.enterManually")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sleepReminderBtn, { backgroundColor: colors.inputBg }]} onPress={onOpenCamera}>
              <Text style={[styles.sleepReminderBtnText, { color: colors.primary }]} numberOfLines={1} ellipsizeMode="tail">
                {t("wellness.uploadScreenshot")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.metricsBlock}>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t("wellness.todayLabel")}</Text>
        <Text style={[styles.hint, styles.disclaimer, { color: colors.textMuted }]}>{t("wellness.disclaimer")}</Text>
        {(effectiveWellnessToday || athleteProfile?.weight_kg != null || effectiveWellnessToday?.weight_kg != null) ? (
          <>
            <View style={[styles.wellnessMetricsRow, { marginTop: 8 }]}>
              <Text style={[styles.wellnessMetricsLine, { color: colors.text }]}>
                {effectiveWellnessToday?.sleep_hours != null
                  ? `${t("wellness.sleep")}\u00A0${formatSleepDuration(effectiveWellnessToday.sleep_hours, t)}`
                  : `${t("wellness.sleep")} —`}
              </Text>
              <View style={styles.metricWithInfo}>
                <Text style={[styles.wellnessMetricsLine, { color: colors.text }]}>
                  {effectiveWellnessToday?.rhr != null ? ` · RHR\u00A0${effectiveWellnessToday.rhr}` : " · RHR —"}
                </Text>
                <TouchableOpacity onPress={showRhrInfo} hitSlop={12} style={styles.infoBtn} accessibilityRole="button" accessibilityLabel={t("common.alerts.info")}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.metricWithInfo}>
                <Text style={[styles.wellnessMetricsLine, { color: colors.text }]}>
                  {effectiveWellnessToday?.hrv != null ? ` · HRV\u00A0${effectiveWellnessToday.hrv}` : " · HRV —"}
                </Text>
                <TouchableOpacity onPress={showHrvInfo} hitSlop={12} style={styles.infoBtn} accessibilityRole="button" accessibilityLabel={t("common.alerts.info")}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.wellnessMetricsLine, { color: colors.text }]}>
                {(effectiveWellnessToday?.weight_kg ?? athleteProfile?.weight_kg) != null
                  ? ` · ${t("wellness.weight")}\u00A0${effectiveWellnessToday?.weight_kg ?? athleteProfile?.weight_kg}\u00A0${t("wellness.weightKg")}`
                  : ` · ${t("wellness.weight")} —`}
              </Text>
            </View>
            {effectiveWellnessToday?.sleep_hours == null && (
              <Text style={[styles.hint, { color: colors.textMuted }]}>{t("wellness.manualHint")}</Text>
            )}
          </>
        ) : (
          <Text style={[styles.placeholder, { color: colors.textMuted, marginTop: 8 }]}>{t("wellness.placeholder")}</Text>
        )}
      </View>

      {combinedSleepHistory.length > 0 ? (
        <View style={styles.weeklyBlock}>
          {combinedSleepHistory.length >= 7 ? (
            <Text style={[styles.weeklySleepLine, { color: colors.text }]}>
              {t("wellness.weeklySleep")}: {Math.round(weeklySleepTotal * 10) / 10} {t("wellness.sleepHours")}
              {weeklySleepDeficit > 0
                ? ` · ${t("wellness.deficit")} ${Math.round(weeklySleepDeficit * 10) / 10} ${t("wellness.sleepHours")}`
                : null}{" "}
              <Text style={[styles.hint, { color: colors.textMuted }]}>({t("wellness.normPerNight")})</Text>
            </Text>
          ) : (
            <Text style={[styles.hint, { color: colors.textMuted }]}>{t("wellness.insufficientData")}</Text>
          )}
        </View>
      ) : null}

      <View style={styles.historyHeader}>
        <Text style={[styles.historyLabel, { color: colors.textMuted }]}>{t("wellness.history")}</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onOpenCamera();
          }}
          style={[styles.addByPhotoBtn, { borderColor: colors.glassBorder }]}
        >
          <Text style={[styles.addByPhotoText, { color: colors.primary }]}>{t("wellness.addByPhoto")}</Text>
        </TouchableOpacity>
      </View>

      {combinedSleepHistory.length === 0 ? (
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t("wellness.uploadSleepPhotoHint")}</Text>
      ) : null}

      {combinedSleepHistory.length > 0 ? (
        <View style={styles.historyList}>
          {combinedSleepHistory.slice(0, 7).map((entry) => (
            <View key={entry.source === "photo" && entry.extraction ? `photo-${entry.extraction.id}` : `wellness-${entry.date}`}>
              <View style={styles.historyRow}>
                <View>
                  <Text style={[styles.sleepHistoryRowText, { color: colors.text }]}>
                    {formatSleepHistoryDate(entry.date)} · {formatSleepDuration(entry.hours, t)}
                    {entry.source === "manual" ? ` (${t("wellness.historyManual")})` : ""}
                  </Text>
                  {entry.source === "photo" &&
                    entry.extraction &&
                    (entry.extraction.quality_score != null ||
                      (entry.extraction.actual_sleep_hours != null &&
                        entry.extraction.sleep_hours != null &&
                        Math.abs((entry.extraction.actual_sleep_hours ?? 0) - (entry.extraction.sleep_hours ?? 0)) > 0.01)) ? (
                    <Text style={[styles.hint, { color: colors.textMuted, marginTop: 2, fontSize: 12 }]}>
                      {entry.extraction.sleep_hours != null &&
                      entry.extraction.actual_sleep_hours != null &&
                      Math.abs(entry.extraction.actual_sleep_hours - entry.extraction.sleep_hours) > 0.01
                        ? `Всего: ${formatSleepDuration(entry.extraction.sleep_hours, t)}`
                        : ""}
                      {entry.extraction.quality_score != null
                        ? `${
                            entry.extraction.sleep_hours != null &&
                            entry.extraction.actual_sleep_hours != null &&
                            Math.abs(entry.extraction.actual_sleep_hours - entry.extraction.sleep_hours) > 0.01
                              ? " · "
                              : ""
                          }${Math.round(entry.extraction.quality_score)}`
                        : ""}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.overflowTrigger}
                  onPress={() => showRowMenu(entry)}
                  disabled={sleepReanalyzingId != null}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.menu")}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {entry.source === "photo" && entry.extraction && sleepReanalyzeExtId === entry.extraction.id ? (
                <View style={styles.reanalyzeForm}>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    value={sleepReanalyzeCorrection}
                    onChangeText={setSleepReanalyzeCorrection}
                    placeholder={t("wellness.reanalyzePlaceholder")}
                    placeholderTextColor={colors.textMuted}
                    editable={sleepReanalyzingId === null}
                  />
                  <View style={styles.reanalyzeActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => {
                        setSleepReanalyzeExtId(null);
                        setSleepReanalyzeCorrection("");
                      }}
                      disabled={sleepReanalyzingId !== null}
                    >
                      <Text style={[styles.cancelBtnText, { color: colors.text }]}>{t("common.cancel")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.submitBtn,
                        { backgroundColor: colors.primary },
                        (sleepReanalyzingId !== null || !sleepReanalyzeCorrection.trim()) && styles.btnDisabled,
                      ]}
                      onPress={() => handleReanalyze(entry.extraction!.id, sleepReanalyzeCorrection)}
                      disabled={sleepReanalyzingId !== null || !sleepReanalyzeCorrection.trim()}
                    >
                      {sleepReanalyzingId === entry.extraction.id ? (
                        <ActivityIndicator size="small" color={colors.primaryText} />
                      ) : (
                        <Text style={[styles.submitBtnText, { color: colors.primaryText }]}>{t("wellness.sendToAnalysis")}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {Platform.OS === "web" && webMenuEntry ? (
        <Modal visible transparent animationType="fade">
          <Pressable
            style={[styles.webMenuBackdrop, { backgroundColor: colors.modalBackdrop }, Platform.OS === "web" && { backdropFilter: "blur(8px)" }]}
            onPress={() => setWebMenuEntry(null)}
          >
            <Pressable
              style={[styles.webMenuBox, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
              onPress={(e) => e.stopPropagation()}
            >
              <TouchableOpacity
                style={styles.webMenuItem}
                onPress={() => {
                  onEditSleepEntry(webMenuEntry.date, webMenuEntry.extraction?.id ?? null);
                  setWebMenuEntry(null);
                }}
              >
                <Text style={[styles.webMenuItemText, { color: colors.text }]}>{t("wellness.edit")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.webMenuItem}
                onPress={() => {
                  if (webMenuEntry.source === "manual") {
                    onDeleteManualSleepEntry(webMenuEntry.date);
                  } else {
                    confirmDelete(webMenuEntry);
                  }
                  setWebMenuEntry(null);
                }}
              >
                <Text style={[styles.webMenuItemText, { color: colors.danger }]}>{t("wellness.deleteEntry")}</Text>
              </TouchableOpacity>
              {webMenuEntry.source === "photo" && webMenuEntry.extraction?.can_reanalyze ? (
                <TouchableOpacity
                  style={styles.webMenuItem}
                  onPress={() => {
                    setSleepReanalyzeExtId(webMenuEntry.extraction!.id);
                    setSleepReanalyzeCorrection("");
                    setWebMenuEntry(null);
                  }}
                >
                  <Text style={[styles.webMenuItemText, { color: colors.text }]}>{t("wellness.reanalyze")}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.webMenuItem} onPress={() => setWebMenuEntry(null)}>
                <Text style={[styles.webMenuItemText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
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
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  editBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  sleepReminder: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  sleepReminderText: {
    fontSize: 14,
    marginBottom: 10,
  },
  sleepReminderButtons: {
    flexDirection: "row",
    gap: 10,
  },
  sleepReminderBtn: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  sleepReminderBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  metricsBlock: {
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
  },
  disclaimer: {
    fontSize: 11,
    marginTop: 2,
  },
  placeholder: {
    fontSize: 16,
  },
  wellnessMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  wellnessMetricsLine: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  metricWithInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoBtn: {
    padding: 4,
    marginLeft: 2,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const, minWidth: 28, minHeight: 28 } : {}),
  },
  weeklyBlock: {
    marginTop: 4,
    marginBottom: 12,
  },
  weeklySleepLine: {
    fontSize: 14,
    marginTop: 8,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  historyLabel: {
    fontSize: 12,
    marginBottom: 0,
  },
  addByPhotoBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  addByPhotoText: {
    fontSize: 14,
    fontWeight: "600",
  },
  historyList: {
    marginTop: 6,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  sleepHistoryRowText: {
    fontSize: 14,
    marginTop: 0,
  },
  overflowTrigger: {
    padding: 8,
    margin: -8,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : {}),
  },
  webMenuBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  webMenuBox: {
    minWidth: 160,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    ...(Platform.OS === "web" ? { boxShadow: "0 4px 12px rgba(0,0,0,0.15)" } : {}),
  },
  webMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : {}),
  },
  webMenuItemText: {
    fontSize: 16,
  },
  reanalyzeForm: {
    marginTop: 6,
    marginBottom: 8,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  reanalyzeActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontSize: 16,
  },
  submitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
