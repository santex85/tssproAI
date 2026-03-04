import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Pressable,
  Platform,
  LayoutAnimation,
  useWindowDimensions,
} from "react-native";
import * as Sentry from "@sentry/react-native";
import { LineChart } from "react-native-gifted-charts";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Swipeable } from "react-native-gesture-handler";
import {
  getNutritionDay,
  createNutritionEntry,
  updateNutritionEntry,
  deleteNutritionEntry,
  reanalyzeNutritionEntry,
  runOrchestrator,
  getWellness,
  createOrUpdateWellness,
  deleteSleepExtraction,
  getSleepExtractions,
  reanalyzeSleepExtraction,
  getAthleteProfile,
  updateAthleteProfile,
  getWorkouts,
  getWorkoutFitness,
  createWorkout,
  uploadFitWorkout,
  previewFitWorkout,
  deleteWorkout,
  uploadPhotoForAnalysis,
  type AthleteProfileResponse,
  type NutritionDayResponse,
  type NutritionDayEntry,
  type AuthUser,
  type WellnessDay,
  type WorkoutItem,
  type WorkoutPreviewItem,
  type WorkoutFitness,
  type SleepExtractionSummary,
  type SleepExtractionResponse,
} from "../api/client";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { useTranslation } from "../i18n";
import { useLoadingStages } from "../hooks/useLoadingStages";
import { PremiumGateModal } from "../components/PremiumGateModal";

const CALORIE_GOAL = 2200;
const CARBS_GOAL = 250;
const PROTEIN_GOAL = 120;
const FAT_GOAL = 80;

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "other"] as const;

function getTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatNavDate(isoDate: string, locale: "ru" | "en"): string {
  const d = new Date(isoDate + "T12:00:00");
  const lang = locale === "ru" ? "ru-RU" : "en-US";
  return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
}

function formatEventDate(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = weekdays[d.getDay()];
  const date = d.getDate();
  const month = d.toLocaleString("default", { month: "short" });
  return `${day} ${date} ${month}`;
}

function formatDuration(sec: number | undefined): string {
  if (sec == null || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSleepDuration(hours: number, t: (key: string) => string): string {
  const hUnit = t("units.hourShort");
  const mUnit = t("units.minuteShort");
  if (hours <= 0) return `0 ${hUnit}`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m <= 0) return `${h} ${hUnit}`;
  return `${h} ${hUnit} ${m} ${mUnit}`;
}

const NutritionProgressBar = React.memo(function NutritionProgressBar({
  current,
  goal,
  label,
  color,
}: {
  current: number;
  goal: number;
  label: string;
  color: string;
}) {
  const percent = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  return (
    <View style={progressBarStyles.container}>
      <View style={progressBarStyles.labelRow}>
        <Text style={progressBarStyles.label}>{label}</Text>
        <Text style={progressBarStyles.value}>
          {Math.round(current)} / {Math.round(goal)}
        </Text>
      </View>
      <View style={progressBarStyles.track}>
        <View style={[progressBarStyles.fill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
});

const progressBarStyles = StyleSheet.create({
  container: { marginTop: 12 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  label: { fontSize: 13, color: "#FFFFFF", fontWeight: "600" },
  value: { fontSize: 13, color: "#e2e8f0" },
  track: { height: 10, backgroundColor: "rgba(255, 255, 255, 0.1)", borderRadius: 100, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 100 },
});

const EditFoodEntryModal = React.memo(function EditFoodEntryModal({
  entry,
  copyTargetDate,
  onClose,
  onSaved,
  onDeleted,
}: {
  entry: NutritionDayEntry;
  copyTargetDate: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(entry.name);
  const [portionGrams, setPortionGrams] = useState(String(entry.portion_grams));
  const [calories, setCalories] = useState(String(entry.calories));
  const [proteinG, setProteinG] = useState(String(entry.protein_g));
  const [fatG, setFatG] = useState(String(entry.fat_g));
  const [carbsG, setCarbsG] = useState(String(entry.carbs_g));
  const [mealType, setMealType] = useState(entry.meal_type);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);

  const handleSave = async () => {
    const p = Number(portionGrams);
    const c = Number(calories);
    const pr = Number(proteinG);
    const f = Number(fatG);
    const ca = Number(carbsG);
    if (Number.isNaN(p) || Number.isNaN(c) || Number.isNaN(pr) || Number.isNaN(f) || Number.isNaN(ca)) {
      Alert.alert(t("common.error"), t("dashboard.validationNumbers"));
      return;
    }
    setSaving(true);
    try {
      await updateNutritionEntry(entry.id, {
        name: name.trim() || undefined,
        portion_grams: p,
        calories: c,
        protein_g: pr,
        fat_g: f,
        carbs_g: ca,
        meal_type: mealType,
      });
      onSaved();
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: "edit_food", action: "save" } });
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const showDeleteConfirm = () => setConfirmDeleteVisible(true);
  const hideDeleteConfirm = () => setConfirmDeleteVisible(false);

  const runDelete = async () => {
    setDeleting(true);
    hideDeleteConfirm();
    try {
      await deleteNutritionEntry(entry.id);
      onDeleted();
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: "edit_food", action: "delete" } });
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleReanalyze = async () => {
    const p = Number(portionGrams);
    if (Number.isNaN(p) || p < 0) {
      Alert.alert(t("common.error"), t("dashboard.validationPortion"));
      return;
    }
    setReanalyzing(true);
    try {
      await reanalyzeNutritionEntry(entry.id, {
        name: name.trim() || undefined,
        portion_grams: p,
      });
      onSaved();
      onClose();
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: "edit_food", action: "reanalyze" } });
      const msg = e instanceof Error ? e.message : t("dashboard.recalcFailed");
      Alert.alert(t("common.error"), msg);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleCopy = async () => {
    const p = Number(portionGrams);
    const c = Number(calories);
    const pr = Number(proteinG);
    const f = Number(fatG);
    const ca = Number(carbsG);
    if (Number.isNaN(p) || Number.isNaN(c) || Number.isNaN(pr) || Number.isNaN(f) || Number.isNaN(ca)) {
      Alert.alert(t("common.error"), t("dashboard.validationNumbers"));
      return;
    }
    setCopying(true);
    try {
      await createNutritionEntry({
        name: name.trim() || entry.name,
        portion_grams: p,
        calories: c,
        protein_g: pr,
        fat_g: f,
        carbs_g: ca,
        meal_type: mealType,
        date: copyTargetDate,
      });
      onSaved();
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: "edit_food", action: "copy" } });
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.copyFailed"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={[styles.modalBackdrop, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={onClose}>
        <Pressable style={[styles.modalBox, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{t("nutrition.entryEditTitle")}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalScroll}>
            <Text style={styles.modalLabel}>{t("nutrition.entryName")}</Text>
            <TextInput
              style={styles.modalInput}
              value={name}
              onChangeText={setName}
              placeholder={t("nutrition.dishNamePlaceholder")}
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>{t("nutrition.portionG")}</Text>
            <TextInput
              style={styles.modalInput}
              value={portionGrams}
              onChangeText={setPortionGrams}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>{t("nutrition.entryCalories")}</Text>
            <TextInput
              style={styles.modalInput}
              value={calories}
              onChangeText={setCalories}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>{t("nutrition.entryProtein")}</Text>
            <TextInput
              style={styles.modalInput}
              value={proteinG}
              onChangeText={setProteinG}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>{t("nutrition.entryFat")}</Text>
            <TextInput
              style={styles.modalInput}
              value={fatG}
              onChangeText={setFatG}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>{t("nutrition.entryCarbs")}</Text>
            <TextInput
              style={styles.modalInput}
              value={carbsG}
              onChangeText={setCarbsG}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>{t("nutrition.mealType")}</Text>
            <View style={styles.mealTypeRow}>
              {MEAL_TYPES.map((mealKey) => (
                <TouchableOpacity
                  key={mealKey}
                  onPress={() => setMealType(mealKey)}
                  style={[styles.mealTypeBtn, mealType === mealKey && styles.mealTypeBtnActive]}
                >
                  <Text style={[styles.mealTypeBtnText, mealType === mealKey && styles.mealTypeBtnTextActive]}>
                    {t(`camera.meal${mealKey.charAt(0).toUpperCase() + mealKey.slice(1)}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {entry.extended_nutrients && Object.keys(entry.extended_nutrients).length > 0 ? (
              <>
                <Text style={[styles.modalLabel, { marginTop: 16 }]}>{t("nutrition.micronutrients")}</Text>
                <View style={styles.micronutrientsBlock}>
                  {Object.entries(entry.extended_nutrients).map(([key, value]) => {
                    const labelKey = `nutrition.micronutrientLabels.${key}`;
                    const label = t(labelKey) !== labelKey ? t(labelKey) : key;
                    return (
                      <View key={key} style={styles.micronutrientRow}>
                        <Text style={styles.micronutrientLabel}>{label}</Text>
                        <Text style={styles.micronutrientValue}>{typeof value === "number" ? Math.round(value * 10) / 10 : value}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}
          </ScrollView>
          {entry.can_reanalyze ? (
            <View style={{ marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtnSave, { backgroundColor: "#0ea5e9" }]}
                onPress={handleReanalyze}
                disabled={saving || deleting || copying || reanalyzing}
              >
                {reanalyzing ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Text style={styles.modalBtnSaveText}>{t("nutrition.recalculate")}</Text>
                )}
              </TouchableOpacity>
              <Text style={[styles.modalLabel, { marginTop: 6, fontSize: 12, opacity: 0.8 }]}>
                {t("nutrition.recalculateHint")}
              </Text>
            </View>
          ) : null}
          {confirmDeleteVisible ? (
            <View style={styles.deleteConfirmBox}>
              <Text style={styles.deleteConfirmTitle}>{t("dashboard.deleteEntryConfirm")}</Text>
              <Text style={styles.deleteConfirmMessage}>{t("dashboard.deleteEntryMessage").replace("{name}", entry.name)}</Text>
              <View style={styles.deleteConfirmActions}>
                <TouchableOpacity style={styles.modalBtnCancel} onPress={hideDeleteConfirm}>
                  <Text style={styles.modalBtnCancelText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtnDelete} onPress={runDelete} disabled={deleting}>
                  {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalBtnDeleteText}>{t("common.delete")}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.modalActionsColumn}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
                <Text style={styles.modalBtnCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnDelete, (saving || deleting || copying || reanalyzing) && styles.modalBtnDisabled]}
                onPress={showDeleteConfirm}
                disabled={saving || deleting || copying || reanalyzing}
              >
                <Text style={styles.modalBtnDeleteText}>{t("common.delete")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnCopy, (saving || deleting || copying || reanalyzing) && styles.modalBtnDisabled]}
                onPress={handleCopy}
                disabled={saving || deleting || copying || reanalyzing}
              >
                {copying ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.modalBtnCopyText}>{t("nutrition.copy")}</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnSave, (saving || deleting || copying || reanalyzing) && styles.modalBtnDisabled]}
                onPress={handleSave}
                disabled={saving || deleting || copying || reanalyzing}
              >
                {saving ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.modalBtnSaveText}>{t("common.save")}</Text>}
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const EditWellnessModal = React.memo(function EditWellnessModal({
  date,
  initialWellness,
  initialWeight,
  onClose,
  onSaved,
}: {
  date: string;
  initialWellness: WellnessDay | null;
  initialWeight: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sleepHours, setSleepHours] = useState(
    initialWellness?.sleep_hours != null ? String(initialWellness.sleep_hours) : ""
  );
  const [rhr, setRhr] = useState(initialWellness?.rhr != null ? String(initialWellness.rhr) : "");
  const [hrv, setHrv] = useState(initialWellness?.hrv != null ? String(initialWellness.hrv) : "");
  const [weightKg, setWeightKg] = useState(initialWeight != null ? String(initialWeight) : "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const sh = sleepHours.trim() ? parseFloat(sleepHours) : undefined;
    const r = rhr.trim() ? parseFloat(rhr) : undefined;
    const h = hrv.trim() ? parseFloat(hrv) : undefined;
    const w = weightKg.trim() ? parseFloat(weightKg) : undefined;
    if (sh !== undefined && (Number.isNaN(sh) || sh < 0 || sh > 24)) {
      Alert.alert(t("common.error"), t("dashboard.validationSleep"));
      return;
    }
    if (r !== undefined && (Number.isNaN(r) || r < 0 || r > 200)) {
      Alert.alert(t("common.error"), t("dashboard.validationRhr"));
      return;
    }
    if (h !== undefined && (Number.isNaN(h) || h < 0)) {
      Alert.alert(t("common.error"), t("dashboard.validationHrv"));
      return;
    }
    if (w !== undefined && (Number.isNaN(w) || w < 20 || w > 300)) {
      Alert.alert(t("common.error"), t("dashboard.validationWeight"));
      return;
    }
    setSaving(true);
    try {
      await createOrUpdateWellness({ date, sleep_hours: sh, rhr: r, hrv: h, weight_kg: w });
      if (w !== undefined) await updateAthleteProfile({ weight_kg: w });
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={[styles.modalBackdrop, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={onClose}>
        <Pressable style={[styles.modalBox, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.cardTitle}>{t("dashboard.wellnessModalTitle").replace("{date}", date)}</Text>
          <Text style={styles.hint}>{t("wellness.disclaimer")}</Text>
          <TextInput
            style={styles.modalInput}
            placeholder={t("wellness.sleepPlaceholder")}
            placeholderTextColor="#64748b"
            value={sleepHours}
            onChangeText={setSleepHours}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.modalInput}
            placeholder={t("wellness.rhrPlaceholder")}
            placeholderTextColor="#64748b"
            value={rhr}
            onChangeText={setRhr}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.modalInput}
            placeholder={t("wellness.hrvPlaceholder")}
            placeholderTextColor="#64748b"
            value={hrv}
            onChangeText={setHrv}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.modalInput}
            placeholder={t("wellness.weightPlaceholder")}
            placeholderTextColor="#64748b"
            value={weightKg}
            onChangeText={setWeightKg}
            keyboardType="decimal-pad"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnSave} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.modalBtnSaveText}>{t("common.save")}</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const AddWorkoutModal = React.memo(function AddWorkoutModal({
  defaultDate,
  onClose,
  onSaved,
}: {
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const loadingStageIndex = useLoadingStages(analyzing, 3, 1600);
  const [dateStr, setDateStr] = useState(defaultDate);
  const [name, setName] = useState("");
  const [type, setType] = useState("Run");
  const [durationMin, setDurationMin] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [tss, setTss] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const handleScan = async () => {
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(t("common.error"), t("dashboard.galleryAccessRequired"));
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      setAnalyzing(true);

      try {
        const response = await uploadPhotoForAnalysis(
          { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.type },
          "workout",
          false
        );

        if (response.type === "workout" && response.workout) {
          const w = response.workout;
          if (w.date) setDateStr(w.date);
          if (w.name) setName(w.name);
          if (w.sport_type) setType(w.sport_type);
          if (w.duration_sec) setDurationMin(String(Math.round(w.duration_sec / 60)));
          if (w.distance_m) setDistanceKm(String((w.distance_m / 1000).toFixed(2)));
          if (w.tss) setTss(String(Math.round(w.tss)));
          if (w.notes) setNotes(w.notes);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          Alert.alert(t("common.alerts.info"), t("dashboard.workoutRecognizeFailed"));
        }
      } catch (e) {
        Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.analyzeFailed"));
      } finally {
        setAnalyzing(false);
      }
    } catch (e) {
      Alert.alert(t("common.error"), t("dashboard.selectImageFailed"));
    }
  };

  const handleSave = async () => {
    const durationSec = durationMin.trim() ? parseInt(durationMin, 10) * 60 : undefined;
    const distanceM = distanceKm.trim() ? parseFloat(distanceKm) * 1000 : undefined;
    const tssVal = tss.trim() ? parseFloat(tss) : undefined;
    if (durationSec !== undefined && (Number.isNaN(durationSec) || durationSec < 0)) {
      Alert.alert(t("common.error"), t("dashboard.validationDuration"));
      return;
    }
    setSaving(true);
    try {
      await createWorkout({
        start_date: `${dateStr}T12:00:00.000Z`,
        name: name.trim() || undefined,
        type: type || undefined,
        duration_sec: durationSec ?? undefined,
        distance_m: distanceM ?? undefined,
        tss: tssVal ?? undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={[styles.modalBackdrop, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={onClose}>
        <Pressable style={[styles.modalBox, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={(e) => e.stopPropagation()}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={styles.cardTitle}>{t("dashboard.addWorkoutTitle")}</Text>
            <TouchableOpacity 
              style={[styles.outlineButton, { borderColor: "#38bdf8" }]} 
              onPress={handleScan}
              disabled={analyzing}
            >
               {analyzing ? <ActivityIndicator size="small" color="#38bdf8" /> : <Text style={styles.outlineButtonText}>📷 {t("dashboard.scanPhoto")}</Text>}
            </TouchableOpacity>
          </View>
          {analyzing ? (
            <Text style={[styles.modalLabel, { marginBottom: 8 }]}>
              {[t("camera.stageUpload"), t("camera.stageDetectType"), t("camera.stageAnalyze")][loadingStageIndex]}
            </Text>
          ) : null}
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalLabel}>{t("dashboard.addWorkoutDateLabel")}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="2024-01-01"
              placeholderTextColor="#64748b"
              value={dateStr}
              onChangeText={setDateStr}
            />
            <Text style={styles.modalLabel}>{t("dashboard.addWorkoutName")}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t("dashboard.placeholderWorkoutName")}
              placeholderTextColor="#64748b"
              value={name}
              onChangeText={setName}
            />
            <Text style={styles.modalLabel}>{t("dashboard.addWorkoutType")}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t("dashboard.sportTypePlaceholder")}
              placeholderTextColor="#64748b"
              value={type}
              onChangeText={setType}
            />
            <Text style={styles.modalLabel}>{t("dashboard.addWorkoutDurationMin")}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="60"
              placeholderTextColor="#64748b"
              value={durationMin}
              onChangeText={setDurationMin}
              keyboardType="numeric"
            />
            <Text style={styles.modalLabel}>{t("dashboard.addWorkoutDistanceKm")}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="10.5"
              placeholderTextColor="#64748b"
              value={distanceKm}
              onChangeText={setDistanceKm}
              keyboardType="decimal-pad"
            />
            <Text style={styles.modalLabel}>TSS</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="50"
              placeholderTextColor="#64748b"
              value={tss}
              onChangeText={setTss}
              keyboardType="numeric"
            />
            <Text style={styles.modalLabel}>{t("dashboard.addWorkoutNotes")}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t("dashboard.placeholderFeelings")}
              placeholderTextColor="#64748b"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnSave} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.modalBtnSaveText}>{t("common.save")}</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const WorkoutPreviewModal = React.memo(function WorkoutPreviewModal({
  file,
  preview,
  onClose,
  onSave,
}: {
  file: Blob;
  preview: WorkoutPreviewItem;
  onClose: () => void;
  onSave: (file: Blob) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const raw = preview.raw as Record<string, unknown> | undefined;
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(file);
      onClose();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={[styles.modalBackdrop, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={onClose}>
        <Pressable style={[styles.modalBox, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.cardTitle}>Превью FIT-тренировки</Text>
          <Text style={styles.modalLabel}>Название / тип</Text>
          <Text style={styles.value}>{preview.name ?? preview.type ?? "—"}</Text>
          <Text style={styles.modalLabel}>Дата и время</Text>
          <Text style={styles.value}>{preview.start_date ? new Date(preview.start_date).toLocaleString() : "—"}</Text>
          <Text style={styles.modalLabel}>Длительность</Text>
          <Text style={styles.value}>{formatDuration(preview.duration_sec ?? undefined) || "—"}</Text>
          {preview.distance_m != null && (
            <>
              <Text style={styles.modalLabel}>Дистанция</Text>
              <Text style={styles.value}>{(preview.distance_m / 1000).toFixed(2)} km</Text>
            </>
          )}
          {preview.tss != null && (
            <>
              <Text style={styles.modalLabel}>TSS</Text>
              <Text style={styles.value}>{Math.round(preview.tss)}</Text>
            </>
          )}
          {raw && (
            <>
              <Text style={[styles.modalLabel, { marginTop: 8 }]}>Из файла (ЧСС, мощность, калории)</Text>
              <View style={{ gap: 2 }}>
                {raw.avg_heart_rate != null && <Text style={styles.hint}>ЧСС ср.: {String(raw.avg_heart_rate)}</Text>}
                {raw.max_heart_rate != null && <Text style={styles.hint}>ЧСС макс.: {String(raw.max_heart_rate)}</Text>}
                {raw.avg_power != null && <Text style={styles.hint}>Мощность ср.: {String(raw.avg_power)} W</Text>}
                {raw.normalized_power != null && <Text style={styles.hint}>NP: {String(raw.normalized_power)} W</Text>}
                {raw.total_calories != null && <Text style={styles.hint}>Калории: {String(raw.total_calories)}</Text>}
              </View>
            </>
          )}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnSave} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.modalBtnSaveText}>{t("common.save")}</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const CHART_MAX_POINTS = 500;
const WORKOUT_CHART_HEIGHT = 160;

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sampleSeries<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(arr[Math.min(Math.floor(i * step), arr.length - 1)]);
  }
  return out;
}

function computeNpFromSeries(series: { power?: number | null }[]): number | null {
  const values = series.map((p) => p.power).filter((v): v is number => v != null && v > 0);
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const sum4 = values.reduce((a, p) => a + p ** 4, 0);
  const np = (sum4 / values.length) ** 0.25;
  return Math.round(np);
}

const WorkoutDetailModal = React.memo(function WorkoutDetailModal({
  workout,
  onClose,
  onDeleted,
}: {
  workout: WorkoutItem | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: chartWidth } = useWindowDimensions();
  const [deleting, setDeleting] = useState(false);
  if (!workout) return null;
  const raw = workout.raw as Record<string, unknown> | undefined;
  const sourceLabel = workout.source === "fit" ? t("dashboard.workoutSourceFit") : workout.source === "intervals" ? t("dashboard.workoutSourceIntervals") : t("dashboard.workoutSourceManual");
  const series = raw?.series as Array<{ elapsed_sec?: number; power?: number | null; speed?: number | null; heart_rate?: number | null }> | undefined;
  const hasSeries = Array.isArray(series) && series.length > 0;
  const sampled = useMemo(() => (hasSeries ? sampleSeries(series, CHART_MAX_POINTS) : []), [series, hasSeries]);
  const labelStep = useMemo(() => Math.max(1, Math.floor(sampled.length / 8)), [sampled.length]);
  const powerData = useMemo(
    () =>
      sampled.map((p, i) => ({
        value: p.power ?? 0,
        label: p.elapsed_sec != null && i % labelStep === 0 ? formatElapsed(p.elapsed_sec) : "",
      })),
    [sampled, labelStep],
  );
  const speedData = useMemo(
    () =>
      sampled.map((p, i) => ({
        value: (p.speed ?? 0) * 3.6,
        label: p.elapsed_sec != null && i % labelStep === 0 ? formatElapsed(p.elapsed_sec) : "",
      })),
    [sampled, labelStep],
  );
  const avgPowerFromSeries = useMemo(() => {
    if (!hasSeries) return null;
    const vals = series.map((p) => p.power).filter((v): v is number => v != null && v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [series, hasSeries]);
  const npFromSeries = useMemo(() => (hasSeries ? computeNpFromSeries(series) : null), [series, hasSeries]);
  const avgPower = (raw?.avg_power as number | undefined) ?? avgPowerFromSeries ?? null;
  const np = (raw?.normalized_power as number | undefined) ?? npFromSeries ?? null;
  const vi = avgPower != null && avgPower > 0 && np != null ? (np / avgPower).toFixed(2) : null;

  const performDelete = async () => {
    setDeleting(true);
    try {
      await deleteWorkout(workout.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onDeleted();
      onClose();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`${t("dashboard.deleteWorkoutTitle")}\n${t("dashboard.deleteWorkoutMessage")}`)) {
        performDelete();
      }
      return;
    }
    Alert.alert(t("dashboard.deleteWorkoutTitle"), t("dashboard.deleteWorkoutMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: performDelete },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={[styles.modalBackdrop, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={onClose}>
        <Pressable style={[styles.modalBox, Platform.OS === "web" && { backdropFilter: "blur(20px)" }, hasSeries && { maxHeight: "85%" }]} onPress={(e) => e.stopPropagation()}>
          <ScrollView style={{ maxHeight: hasSeries ? 400 : undefined }} showsVerticalScrollIndicator>
            <Text style={styles.cardTitle}>{t("dashboard.workoutFallbackName")}</Text>
            <Text style={styles.modalLabel}>{t("dashboard.workoutDetailNameType")}</Text>
            <Text style={styles.value}>{workout.name ?? workout.type ?? "—"}</Text>
            <Text style={styles.modalLabel}>{t("dashboard.workoutDetailDateTime")}</Text>
            <Text style={styles.value}>{workout.start_date ? new Date(workout.start_date).toLocaleString() : "—"}</Text>
            <Text style={styles.modalLabel}>{t("dashboard.workoutDetailSource")}</Text>
            <Text style={styles.value}>{sourceLabel}</Text>
            <Text style={styles.modalLabel}>{t("dashboard.workoutDetailDuration")}</Text>
            <Text style={styles.value}>{formatDuration(workout.duration_sec ?? undefined) || "—"}</Text>
            {workout.distance_m != null && (
              <>
                <Text style={styles.modalLabel}>{t("dashboard.workoutDetailDistance")}</Text>
                <Text style={styles.value}>{(workout.distance_m / 1000).toFixed(2)} km</Text>
              </>
            )}
            {workout.tss != null && (
              <>
                <Text style={styles.modalLabel}>TSS</Text>
                <Text style={styles.value}>{Math.round(workout.tss)}</Text>
              </>
            )}
            {workout.notes && (
              <>
                <Text style={styles.modalLabel}>{t("dashboard.workoutDetailNotes")}</Text>
                <Text style={styles.hint}>{workout.notes}</Text>
              </>
            )}
            {raw && (workout.source === "fit" || workout.source === "intervals") && (
            <>
              <Text style={[styles.modalLabel, { marginTop: 8 }]}>{t("dashboard.workoutDetailFromData")}</Text>
              <View style={{ gap: 2 }}>
                {raw.avg_heart_rate != null && <Text style={styles.hint}>ЧСС ср.: {String(raw.avg_heart_rate)}</Text>}
                {raw.max_heart_rate != null && <Text style={styles.hint}>ЧСС макс.: {String(raw.max_heart_rate)}</Text>}
                {raw.avg_power != null && <Text style={styles.hint}>Мощность ср.: {String(raw.avg_power)} W</Text>}
                {raw.normalized_power != null && <Text style={styles.hint}>NP: {String(raw.normalized_power)} W</Text>}
                {raw.total_calories != null && <Text style={styles.hint}>Калории: {String(raw.total_calories)}</Text>}
              </View>
            </>
          )}
          {hasSeries && (
            <>
              {(avgPower != null || np != null || vi != null) && (
                <View style={{ marginTop: 12, gap: 4 }}>
                  <Text style={[styles.modalLabel, { marginTop: 8 }]}>{t("dashboard.workoutDetailPowerMetrics")}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {avgPower != null && <Text style={styles.hint}>Ср. мощность: {avgPower} W</Text>}
                    {np != null && <Text style={styles.hint}>NP: {np} W</Text>}
                    {vi != null && <Text style={styles.hint}>VI: {vi}</Text>}
                  </View>
                </View>
              )}
              {powerData.some((d) => d.value > 0) && (
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.modalLabel, { marginBottom: 4 }]}>{t("dashboard.workoutDetailPowerW")}</Text>
                  <View style={{ height: WORKOUT_CHART_HEIGHT }}>
                    <LineChart
                      data={powerData}
                      width={Math.max(chartWidth - 80, powerData.length * 2)}
                      height={WORKOUT_CHART_HEIGHT - 24}
                      color={colors.primary ?? "#3b82f6"}
                      thickness={1.5}
                      hideDataPoints={powerData.length > 30}
                      yAxisColor={colors.glassBorder ?? "rgba(255,255,255,0.1)"}
                      xAxisColor={colors.glassBorder ?? "rgba(255,255,255,0.1)"}
                      noOfSections={4}
                      yAxisLabelWidth={32}
                      xAxisLabelTextStyle={{ color: colors.textMuted ?? "#888", fontSize: 9 }}
                      yAxisTextStyle={{ color: colors.textMuted ?? "#888", fontSize: 9 }}
                    />
                  </View>
                </View>
              )}
              {speedData.some((d) => d.value > 0) && (
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.modalLabel, { marginBottom: 4 }]}>{t("dashboard.workoutDetailSpeedKmh")}</Text>
                  <View style={{ height: WORKOUT_CHART_HEIGHT }}>
                    <LineChart
                      data={speedData}
                      width={Math.max(chartWidth - 80, speedData.length * 2)}
                      height={WORKOUT_CHART_HEIGHT - 24}
                      color={colors.primary ?? "#8b5cf6"}
                      thickness={1.5}
                      hideDataPoints={speedData.length > 30}
                      yAxisColor={colors.glassBorder ?? "rgba(255,255,255,0.1)"}
                      xAxisColor={colors.glassBorder ?? "rgba(255,255,255,0.1)"}
                      noOfSections={4}
                      yAxisLabelWidth={32}
                      xAxisLabelTextStyle={{ color: colors.textMuted ?? "#888", fontSize: 9 }}
                      yAxisTextStyle={{ color: colors.textMuted ?? "#888", fontSize: 9 }}
                    />
                  </View>
                </View>
              )}
            </>
          )}
          </ScrollView>
          <View style={[styles.modalActions, styles.deleteConfirmBox]}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnCancelText}>{t("common.close")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnDelete} onPress={handleDelete} disabled={deleting}>
              {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalBtnDeleteText}>{t("common.delete")}</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

export function DashboardScreen({
  user,
  onLogout,
  onOpenCamera,
  onOpenChat,
  onOpenAthleteProfile,
  onOpenIntervals,
  onSyncIntervals,
  onOpenPricing,
  refreshNutritionTrigger = 0,
  refreshSleepTrigger = 0,
  refreshWellnessTrigger = 0,
  lastSavedSleep = null,
  onClearLastSavedSleep,
}: {
  user?: AuthUser | null;
  onLogout?: () => void;
  onOpenCamera: () => void;
  onOpenChat: () => void;
  onOpenAthleteProfile?: () => void;
  onOpenIntervals?: () => void;
  onOpenPricing?: () => void;
  onSyncIntervals?: () => Promise<{ activities_synced?: number; wellness_days_synced?: number } | void>;
  refreshNutritionTrigger?: number;
  refreshSleepTrigger?: number;
  refreshWellnessTrigger?: number;
  lastSavedSleep?: SleepExtractionResponse | null;
  onClearLastSavedSleep?: () => void;
}) {
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [workoutFitness, setWorkoutFitness] = useState<WorkoutFitness | null>(null);
  const [nutritionDay, setNutritionDay] = useState<NutritionDayResponse | null>(null);
  const [nutritionLoadError, setNutritionLoadError] = useState(false);
  const [nutritionDate, setNutritionDate] = useState(getTodayLocal);
  const [entryToEdit, setEntryToEdit] = useState<NutritionDayEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [wellnessToday, setWellnessToday] = useState<WellnessDay | null>(null);
  const [wellnessWeek, setWellnessWeek] = useState<WellnessDay[]>([]);
  const [athleteProfile, setAthleteProfile] = useState<AthleteProfileResponse | null>(null);
  const [wellnessEditVisible, setWellnessEditVisible] = useState(false);
  const [workoutAddVisible, setWorkoutAddVisible] = useState(false);
  const [fitUploading, setFitUploading] = useState(false);
  const [fitPreviewData, setFitPreviewData] = useState<{ file: Blob; preview: WorkoutPreviewItem } | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutItem | null>(null);
  const [lastAnalysisResult, setLastAnalysisResult] = useState<{
    decision: string;
    reason: string;
    suggestions_next_days?: string;
    evening_tips?: string;
    plan_tomorrow?: string;
  } | null>(null);
  const [intervalsSyncLoading, setIntervalsSyncLoading] = useState(false);
  const [sleepExtractions, setSleepExtractions] = useState<SleepExtractionSummary[]>([]);
  const effectiveSleepExtractions = useMemo((): SleepExtractionSummary[] => {
    if (!lastSavedSleep) return sleepExtractions;
    const d = lastSavedSleep.extracted_data;
    const summary: SleepExtractionSummary = {
      id: lastSavedSleep.id,
      created_at: lastSavedSleep.created_at,
      sleep_date: d?.date ?? lastSavedSleep.created_at?.slice(0, 10) ?? null,
      sleep_hours: d?.actual_sleep_hours ?? d?.sleep_hours ?? null,
      actual_sleep_hours: d?.actual_sleep_hours ?? null,
      quality_score: d?.quality_score ?? null,
    };
    const exists = sleepExtractions.some((s) => s.id === summary.id);
    if (exists) return sleepExtractions;
    return [summary, ...sleepExtractions];
  }, [lastSavedSleep, sleepExtractions]);
  const [sleepReanalyzingId, setSleepReanalyzingId] = useState<number | null>(null);
  const [sleepReanalyzeExtId, setSleepReanalyzeExtId] = useState<number | null>(null);
  const [sleepReanalyzeCorrection, setSleepReanalyzeCorrection] = useState("");
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuView, setMenuView] = useState<"main" | "settings">("main");
  const [premiumGateVisible, setPremiumGateVisible] = useState(false);
  const { t, locale, setLocale } = useTranslation();
  const { colors, toggleTheme } = useTheme();

  const glassCardStyle = useMemo(() => [
    styles.cardBase,
    {
      backgroundColor: colors.glassBg,
      borderColor: colors.glassBorder,
      borderWidth: 1,
      borderRadius: colors.borderRadiusLg,
      padding: 20,
    },
    ...(Platform.OS === "web" ? [{ backdropFilter: "blur(20px)" }] : []),
  ], [colors]);

  const today = getTodayLocal();

  const loadNutritionForDate = useCallback(async (dateStr: string) => {
    setNutritionLoadError(false);
    try {
      const n = await getNutritionDay(dateStr);
      setNutritionDay(n);
    } catch {
      setNutritionDay(null);
      setNutritionLoadError(true);
    }
  }, []);

  const load = useCallback(async () => {
    setNutritionLoadError(false);
    try {
      const activitiesStart = addDays(today, -14);
      const [nResult, wellnessResult, profile, workoutsList, fitness, sleepList] = await Promise.all([
        getNutritionDay(nutritionDate).then((n) => ({ ok: true as const, data: n })).catch(() => ({ ok: false as const, data: null })),
        getWellness(addDays(today, -13), addDays(today, 1)).then((res) => {
          const w = res?.items ?? [];
          setWellnessWeek(w);
          if (!w.length) return { week: w, today: null };
          const todayNorm = today.slice(0, 10);
          const forToday = w.find((d) => String(d?.date ?? "").slice(0, 10) === todayNorm);
          return { week: w, today: forToday ?? null };
        }).catch(() => {
          setWellnessWeek([]);
          return { week: [], today: null };
        }),
        getAthleteProfile().catch(() => null),
        getWorkouts(activitiesStart, today).then((r) => r.items).catch(() => []),
        getWorkoutFitness().catch(() => null),
        (async (): Promise<SleepExtractionSummary[]> => {
          try {
            return await getSleepExtractions(addDays(today, -14), today);
          } catch {
            await new Promise((r) => setTimeout(r, 1500));
            try {
              return await getSleepExtractions(addDays(today, -14), today);
            } catch {
              return [];
            }
          }
        })(),
      ]);
      setNutritionDay(nResult.ok ? nResult.data : null);
      setNutritionLoadError(!nResult.ok);
      setWellnessToday(wellnessResult?.today ?? null);
      setAthleteProfile(profile);
      setWorkouts(workoutsList ?? []);
      setWorkoutFitness(fitness ?? null);
      setSleepExtractions(sleepList ?? []);
      onClearLastSavedSleep?.();
    } catch {
      setNutritionDay(null);
      setNutritionLoadError(true);
      setWellnessToday(null);
      setWellnessWeek([]);
      setAthleteProfile(null);
      setWorkouts([]);
      setWorkoutFitness(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [today, nutritionDate]);

  useEffect(() => {
    load();
  }, [load, refreshNutritionTrigger, refreshSleepTrigger, refreshWellnessTrigger]);

  const setNutritionDateAndLoad = useCallback(
    (dateStr: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setNutritionDate(dateStr);
      loadNutritionForDate(dateStr);
    },
    [loadNutritionForDate]
  );

  const nutritionGoals = useMemo(
    () => ({
      calorieGoal: athleteProfile?.nutrition_goals?.calorie_goal ?? CALORIE_GOAL,
      proteinGoal: athleteProfile?.nutrition_goals?.protein_goal ?? PROTEIN_GOAL,
      fatGoal: athleteProfile?.nutrition_goals?.fat_goal ?? FAT_GOAL,
      carbsGoal: athleteProfile?.nutrition_goals?.carbs_goal ?? CARBS_GOAL,
    }),
    [
      athleteProfile?.nutrition_goals?.calorie_goal,
      athleteProfile?.nutrition_goals?.protein_goal,
      athleteProfile?.nutrition_goals?.fat_goal,
      athleteProfile?.nutrition_goals?.carbs_goal,
    ]
  );
  const { calorieGoal, proteinGoal, fatGoal, carbsGoal } = nutritionGoals;

  const WEEKLY_SLEEP_NORM_HOURS = 7 * 7;

  const normalizeSleepDateKey = (raw: string | null | undefined): string => {
    const s = String(raw ?? "").trim();
    if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (s.length >= 7 && /^\d{4}-\d{2}/.test(s)) return `${s.slice(0, 7)}-01`;
    return "";
  };

  const formatSleepHistoryDate = (dateKey: string): string => {
    if (dateKey.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(dateKey.slice(0, 10)))
      return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
    return "—/—";
  };

  type SleepHistoryEntry = { date: string; hours: number; source: "photo" | "manual"; extraction?: SleepExtractionSummary };

  const combinedSleepHistory = useMemo(() => {
    const byDate = new Map<string, SleepHistoryEntry>();
    wellnessWeek.forEach((d) => {
      const h = d?.sleep_hours ?? 0;
      if (h <= 0) return;
      const dateKey = normalizeSleepDateKey(d?.date);
      if (!dateKey) return;
      byDate.set(dateKey, { date: dateKey, hours: h, source: "manual" });
    });
    const currentYear = new Date().getFullYear();
    effectiveSleepExtractions.forEach((ext) => {
      let raw = ext.sleep_date ?? ext.created_at?.slice(0, 10) ?? "";
      if (raw.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const year = parseInt(raw.slice(0, 4), 10);
        if (!Number.isNaN(year) && year !== currentYear && ext.created_at) {
          raw = ext.created_at.slice(0, 10);
        }
      }
      const dateKey = normalizeSleepDateKey(raw);
      if (!dateKey) return;
      const hours = ext.actual_sleep_hours ?? ext.sleep_hours ?? 0;
      byDate.set(dateKey, { date: dateKey, hours, source: "photo", extraction: ext });
    });
    const arr = Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
    const byDisplayDate = new Map<string, SleepHistoryEntry>();
    arr.forEach((entry) => {
      const displayKey = formatSleepHistoryDate(entry.date);
      if (!byDisplayDate.has(displayKey)) byDisplayDate.set(displayKey, entry);
      else if (entry.source === "photo" && byDisplayDate.get(displayKey)?.source === "manual")
        byDisplayDate.set(displayKey, entry);
    });
    return Array.from(byDisplayDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [wellnessWeek, effectiveSleepExtractions]);

  const { weeklySleepTotal, weeklySleepDeficit } = useMemo(() => {
    const last7 = combinedSleepHistory.slice(0, 7);
    const total = last7.reduce((sum, e) => sum + e.hours, 0);
    const deficit = Math.max(0, WEEKLY_SLEEP_NORM_HOURS - total);
    return { weeklySleepTotal: total, weeklySleepDeficit: deficit };
  }, [combinedSleepHistory]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleQuickDelete = (entry: NutritionDayEntry) => {
    Alert.alert(t("dashboard.deleteEntryConfirm"), t("dashboard.deleteEntryMessage").replace("{name}", entry.name), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteNutritionEntry(entry.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            loadNutritionForDate(nutritionDate);
          } catch (e) {
            Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.deleteFailed"));
          }
        },
      },
    ]);
  };

  const onSelectFitFile = useCallback(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      Alert.alert("FIT", t("fit.webOnly"));
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".fit";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setFitUploading(true);
      try {
        const preview = await previewFitWorkout(file);
        setFitPreviewData({ file, preview });
      } catch (err) {
        Alert.alert(t("common.error"), err instanceof Error ? err.message : t("dashboard.parseFitFailed"));
      } finally {
        setFitUploading(false);
      }
    };
    input.click();
  }, []);

  const onSaveFitFromPreview = useCallback(
    async (file: Blob) => {
      await uploadFitWorkout(file);
      setFitPreviewData(null);
      load();
    },
    [load]
  );

  const onRunAnalysisNow = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setAnalysisLoading(true);
    setLastAnalysisResult(null);
    try {
      const result = await runOrchestrator(locale, new Date().getHours());
      setLastAnalysisResult(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      if (msg.includes("Premium") || msg.includes("403")) {
        setPremiumGateVisible(true);
      } else {
        Alert.alert("Ошибка", msg);
      }
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setMenuVisible(false); setMenuView("main"); }}
      >
        <Pressable style={[styles.menuBackdrop, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={() => { setMenuVisible(false); setMenuView("main"); }}>
          <Pressable style={[styles.menuBox, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]} onPress={(e) => e.stopPropagation()}>
            {menuView === "main" ? (
              <>
                <View style={styles.menuHeader}>
                  <View style={styles.menuHeaderLeft}>
                    {user?.email ? <Text style={styles.menuEmail} numberOfLines={1}>{user.email}</Text> : null}
                    {athleteProfile?.is_premium ? (
                      <View style={[styles.proBadge, { backgroundColor: colors.primary + "33" }]}>
                        <Text style={[styles.proBadgeText, { color: colors.primary }]}>Pro</Text>
                      </View>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setMenuVisible(false); setMenuView("main"); }}
                    style={styles.menuCloseBtn}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel={t("common.close")}
                  >
                    <Text style={styles.menuCloseIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setMenuView("settings"); }}
                >
                  <Ionicons name="settings-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                  <Text style={styles.menuItemText}>{t("settings.title")}</Text>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.menuItemChevron} />
                </Pressable>
                {onLogout ? (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
                onPress={() => { onLogout(); setMenuVisible(false); }}
              >
                <Ionicons name="power-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                <Text style={styles.menuItemText}>{t("app.logout")}</Text>
              </Pressable>
            ) : null}
            {onOpenAthleteProfile ? (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
                onPress={() => { onOpenAthleteProfile(); setMenuVisible(false); }}
              >
                <Ionicons name="person-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                <Text style={styles.menuItemText}>{t("athleteProfile.title")}</Text>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.menuItemChevron} />
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
              onPress={() => { onOpenChat(); setMenuVisible(false); }}
            >
              <Ionicons name="chatbubble-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
              <Text style={styles.menuItemText}>{t("chat.openCoachChat")}</Text>
              <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.menuItemChevron} />
            </Pressable>
            {onOpenPricing ? (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
                onPress={() => { onOpenPricing(); setMenuVisible(false); }}
              >
                <Ionicons name="card-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                <Text style={styles.menuItemText}>{t("pricing.title")}</Text>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.menuItemChevron} />
              </Pressable>
            ) : null}
              </>
            ) : (
              <>
                <View style={styles.menuHeader}>
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setMenuView("main"); }}
                    style={styles.menuBackBtn}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="arrow-back" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                    <Text style={styles.menuItemText}>{t("settings.back")}</Text>
                  </TouchableOpacity>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); toggleTheme(); }}
                >
                  <Ionicons name="color-palette-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                  <Text style={styles.menuItemText}>{t("settings.theme")}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255, 255, 255, 0.05)" }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    setLocale(locale === "ru" ? "en" : "ru");
                  }}
                >
                  <Ionicons name="language-outline" size={22} color="#9ca3af" style={styles.menuItemIcon} />
                  <Text style={styles.menuItemText}>{t("settings.language")}</Text>
                  <Text style={[styles.menuItemText, { flex: 0, color: "#94a3b8", fontSize: 14 }]}>
                    {locale === "ru" ? t("settings.langRu") : t("settings.langEn")}
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <PremiumGateModal
        visible={premiumGateVisible}
        onClose={() => setPremiumGateVisible(false)}
        onUpgrade={() => { setPremiumGateVisible(false); onOpenPricing?.(); }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <View style={styles.contentWrap}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brandTitle}>{t("app.brandTitle")}</Text>
          <Text style={styles.brandAlpha}>{t("app.brandAlpha")}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setMenuVisible(true);
          }}
          style={styles.menuIconBtn}
          accessibilityLabel={t("common.menu")}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>{t("today")}</Text>

      {loading ? (
        <View style={styles.skeletonWrap}>
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonLine} />
            <View style={styles.skeletonLine} />
            <View style={styles.skeletonLineShort} />
          </View>
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonLine} />
          </View>
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonLine} />
          </View>
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonLine} />
            <View style={styles.skeletonLine} />
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>{t("nutrition.title")}</Text>
          <View style={glassCardStyle}>
            <View style={[styles.cardTitleRow, { justifyContent: "flex-end" }]}>
              <View style={styles.cardTitleActions}>
                <TouchableOpacity
                  onPress={() => setNutritionDateAndLoad(addDays(nutritionDate, -1))}
                  style={styles.dateNavBtn}
                >
                  <Text style={styles.dateNavText}>{formatNavDate(addDays(nutritionDate, -1), locale)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setNutritionDateAndLoad(today)}
                  style={[styles.dateNavBtn, styles.dateNavBtnActive]}
                >
                  <Text style={[styles.dateNavText, styles.dateNavTextActive]}>{formatNavDate(nutritionDate, locale)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setNutritionDateAndLoad(addDays(nutritionDate, 1))}
                  style={styles.dateNavBtn}
                >
                  <Text style={styles.dateNavText}>{formatNavDate(addDays(nutritionDate, 1), locale)}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {nutritionLoadError && (
              <Text style={styles.errorHint}>{t("nutrition.loadError")}</Text>
            )}
            {!nutritionLoadError && nutritionDay && nutritionDay.entries.length > 0 ? (
              <>
                <Text style={styles.hintRemaining}>
                  {t("nutrition.left")}: {Math.round(Math.max(0, calorieGoal - nutritionDay.totals.calories))} {t("nutrition.kcal")} · {t("nutrition.proteinShort")}{" "}
                  {Math.round(Math.max(0, proteinGoal - nutritionDay.totals.protein_g))}{t("nutrition.grams")} · {t("nutrition.fatShort")}{" "}
                  {Math.round(Math.max(0, fatGoal - nutritionDay.totals.fat_g))}{t("nutrition.grams")} · {t("nutrition.carbsShort")}{" "}
                  {Math.round(Math.max(0, carbsGoal - nutritionDay.totals.carbs_g))}{t("nutrition.grams")}
                </Text>
                <NutritionProgressBar
                  current={nutritionDay.totals.calories}
                  goal={calorieGoal}
                  label={t("nutrition.caloriesLabel")}
                  color="#22D3EE"
                />
                <NutritionProgressBar
                  current={nutritionDay.totals.protein_g}
                  goal={proteinGoal}
                  label={t("nutrition.proteinLabel")}
                  color="#4ADE80"
                />
                <NutritionProgressBar
                  current={nutritionDay.totals.fat_g}
                  goal={fatGoal}
                  label={t("nutrition.fatLabel")}
                  color="#FBBF24"
                />
                <NutritionProgressBar
                  current={nutritionDay.totals.carbs_g}
                  goal={carbsGoal}
                  label={t("nutrition.carbsLabel")}
                  color="#A78BFA"
                />
                {nutritionDay.entries.map((entry) => (
                  <Swipeable
                    key={entry.id}
                    renderRightActions={() => (
                      <TouchableOpacity style={styles.deleteAction} onPress={() => handleQuickDelete(entry)}>
                        <Text style={styles.deleteActionText}>{t("common.delete")}</Text>
                      </TouchableOpacity>
                    )}
                  >
                    <TouchableOpacity
                      onPress={() => setEntryToEdit(entry)}
                      style={styles.mealRow}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="restaurant-outline" size={18} color="#9ca3af" style={styles.mealRowIcon} />
                      <Text style={styles.mealLine}>
                        {entry.name}: {Math.round(entry.calories)} kcal
                      </Text>
                    </TouchableOpacity>
                  </Swipeable>
                ))}
              </>
            ) : !nutritionLoadError && nutritionDay ? (
              <>
                <Text style={styles.placeholder}>{t("nutrition.placeholder")}</Text>
                <Text style={styles.hint}>{t("nutrition.goal")}: {calorieGoal} {t("nutrition.kcal")} · {t("nutrition.carbsShort")}: {carbsGoal}{t("nutrition.grams")} · {t("nutrition.proteinShort")}: {proteinGoal}{t("nutrition.grams")} · {t("nutrition.fatShort")}: {fatGoal}{t("nutrition.grams")}</Text>
                <NutritionProgressBar current={nutritionDay.totals.calories} goal={calorieGoal} label={t("nutrition.caloriesLabel")} color="#22D3EE" />
                <NutritionProgressBar current={nutritionDay.totals.protein_g} goal={proteinGoal} label={t("nutrition.proteinLabel")} color="#4ADE80" />
                <NutritionProgressBar current={nutritionDay.totals.fat_g} goal={fatGoal} label={t("nutrition.fatLabel")} color="#FBBF24" />
                <NutritionProgressBar current={nutritionDay.totals.carbs_g} goal={carbsGoal} label={t("nutrition.carbsLabel")} color="#A78BFA" />
              </>
            ) : !nutritionLoadError ? (
              <>
                <Text style={styles.placeholder}>{t("nutrition.placeholder")}</Text>
                <Text style={styles.hint}>{t("nutrition.goal")}: {calorieGoal} {t("nutrition.kcal")} · {t("nutrition.carbsShort")}: {carbsGoal}{t("nutrition.grams")} · {t("nutrition.proteinShort")}: {proteinGoal}{t("nutrition.grams")} · {t("nutrition.fatShort")}: {fatGoal}{t("nutrition.grams")}</Text>
              </>
            ) : null}
          </View>

          <View style={glassCardStyle}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>{t("wellness.title")}</Text>
              <TouchableOpacity onPress={() => setWellnessEditVisible(true)} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>{t("wellness.edit")}</Text>
              </TouchableOpacity>
            </View>
            {wellnessToday?.sleep_hours == null ? (
              <View style={[styles.sleepReminderBanner, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                <Text style={styles.sleepReminderText}>{t("wellness.sleepReminder")}</Text>
                <View style={styles.sleepReminderButtons}>
                  <TouchableOpacity style={styles.sleepReminderBtn} onPress={() => setWellnessEditVisible(true)}>
                    <Text style={styles.sleepReminderBtnText}>{t("wellness.enterManually")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sleepReminderBtn} onPress={onOpenCamera}>
                    <Text style={styles.sleepReminderBtnText}>{t("wellness.uploadScreenshot")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.hint}>{t("wellness.todayLabel")}</Text>
              <Text style={[styles.hint, styles.disclaimer]}>{t("wellness.disclaimer")}</Text>
              {(wellnessToday || athleteProfile?.weight_kg != null || wellnessToday?.weight_kg != null) ? (
                <>
                  <Text style={[styles.wellnessMetricsLine, { marginTop: 8 }]}>
                    {wellnessToday?.sleep_hours != null ? `${t("wellness.sleep")}\u00A0${formatSleepDuration(wellnessToday.sleep_hours, t)}` : `${t("wellness.sleep")} —`}
                    {wellnessToday?.rhr != null ? ` · RHR\u00A0${wellnessToday.rhr}` : " · RHR —"}
                    {wellnessToday?.hrv != null ? ` · HRV\u00A0${wellnessToday.hrv}` : " · HRV —"}
                    {(wellnessToday?.weight_kg ?? athleteProfile?.weight_kg) != null
                      ? ` · ${t("wellness.weight")}\u00A0${wellnessToday?.weight_kg ?? athleteProfile?.weight_kg}\u00A0${t("wellness.weightKg")}`
                      : ` · ${t("wellness.weight")} —`}
                  </Text>
                  {wellnessToday?.sleep_hours == null && (
                    <Text style={styles.hint}>{t("wellness.manualHint")}</Text>
                  )}
                </>
              ) : (
                <Text style={[styles.placeholder, { marginTop: 8 }]}>{t("wellness.placeholder")}</Text>
              )}
            </View>
            {combinedSleepHistory.length > 0 ? (
              <View style={{ marginTop: 4, marginBottom: 12 }}>
                {combinedSleepHistory.length >= 7 ? (
                  <Text style={styles.weeklySleepLine}>
                    {t("wellness.weeklySleep")}: {Math.round(weeklySleepTotal * 10) / 10} {t("wellness.sleepHours")}
                    {weeklySleepDeficit > 0 ? ` · ${t("wellness.deficit")} ${Math.round(weeklySleepDeficit * 10) / 10} ${t("wellness.sleepHours")}` : null}
                    {" "}
                    <Text style={[styles.hint, { marginTop: 0 }]}>({t("wellness.normPerNight")})</Text>
                  </Text>
                ) : (
                  <Text style={[styles.hint, { marginTop: 8 }]}>{t("wellness.insufficientData")}</Text>
                )}
              </View>
            ) : null}
            <View style={{ marginTop: 4 }}>
              <View style={styles.cardTitleRow}>
                <Text style={[styles.modalLabel, { marginBottom: 0 }]}>{t("wellness.history")}</Text>
                <TouchableOpacity
                  style={styles.outlineButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    onOpenCamera();
                  }}
                >
                  <Text style={styles.outlineButtonText}>{t("wellness.addByPhoto")}</Text>
                </TouchableOpacity>
              </View>
              {combinedSleepHistory.length === 0 ? (
                <Text style={[styles.hint, { marginTop: 4 }]}>{t("wellness.uploadSleepPhotoHint")}</Text>
              ) : null}
            </View>
            {combinedSleepHistory.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                {combinedSleepHistory.slice(0, 7).map((entry) => (
                  <View key={entry.source === "photo" && entry.extraction ? `photo-${entry.extraction.id}` : `wellness-${entry.date}`}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
                      <View>
                        <Text style={styles.sleepHistoryRowText}>
                          {formatSleepHistoryDate(entry.date)} · {formatSleepDuration(entry.hours, t)}
                          {entry.source === "manual" ? ` (${t("wellness.historyManual")})` : ""}
                        </Text>
                        {entry.source === "photo" && entry.extraction && (entry.extraction.quality_score != null || (entry.extraction.actual_sleep_hours != null && entry.extraction.sleep_hours != null && Math.abs((entry.extraction.actual_sleep_hours ?? 0) - (entry.extraction.sleep_hours ?? 0)) > 0.01)) ? (
                          <Text style={[styles.hint, { marginTop: 2, fontSize: 12 }]}>
                            {entry.extraction.sleep_hours != null && entry.extraction.actual_sleep_hours != null && Math.abs((entry.extraction.actual_sleep_hours - entry.extraction.sleep_hours)) > 0.01
                              ? `Всего: ${formatSleepDuration(entry.extraction.sleep_hours, t)}`
                              : ""}
                            {entry.extraction.quality_score != null ? `${entry.extraction.sleep_hours != null && entry.extraction.actual_sleep_hours != null && Math.abs((entry.extraction.actual_sleep_hours - entry.extraction.sleep_hours)) > 0.01 ? " · " : ""}${Math.round(entry.extraction.quality_score)}` : ""}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {entry.source === "photo" && entry.extraction?.can_reanalyze && sleepReanalyzeExtId !== entry.extraction.id ? (
                          <TouchableOpacity
                            style={[styles.modalBtnSave, { paddingHorizontal: 10, paddingVertical: 6 }]}
                            onPress={() => { setSleepReanalyzeExtId(entry.extraction!.id); setSleepReanalyzeCorrection(""); }}
                            disabled={sleepReanalyzingId != null}
                          >
                            <Text style={styles.modalBtnSaveText}>{t("wellness.reanalyze")}</Text>
                          </TouchableOpacity>
                        ) : null}
                        {entry.source === "photo" && entry.extraction ? (
                          <TouchableOpacity
                            style={[styles.deleteAction, { paddingHorizontal: 10, paddingVertical: 6 }]}
                            onPress={async () => {
                              const doDelete = async () => {
                                if (!entry.extraction) return;
                                try {
                                  await deleteSleepExtraction(entry.extraction.id);
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                                  load();
                                  const fresh = await getSleepExtractions(addDays(today, -14), today).catch(() => []);
                                  setSleepExtractions(fresh ?? []);
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
                              if (Platform.OS === "web" && typeof window !== "undefined") {
                                if (window.confirm(`${t("wellness.deleteSleepEntryTitle")}\n${t("wellness.deleteSleepEntryMessage")}`)) {
                                  await doDelete();
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
                            }}
                          >
                            <Text style={styles.deleteActionText}>{t("wellness.deleteEntry")}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                    {entry.source === "photo" && entry.extraction && sleepReanalyzeExtId === entry.extraction.id ? (
                      <View style={{ marginTop: 6, marginBottom: 8 }}>
                        <TextInput
                          style={styles.modalInput}
                          value={sleepReanalyzeCorrection}
                          onChangeText={setSleepReanalyzeCorrection}
                          placeholder={t("wellness.reanalyzePlaceholder")}
                          placeholderTextColor="#64748b"
                          editable={sleepReanalyzingId === null}
                        />
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                          <TouchableOpacity
                            style={styles.modalBtnCancel}
                            onPress={() => { setSleepReanalyzeExtId(null); setSleepReanalyzeCorrection(""); }}
                            disabled={sleepReanalyzingId !== null}
                          >
                            <Text style={styles.modalBtnCancelText}>{t("common.cancel")}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.modalBtnSave, (sleepReanalyzingId !== null || !sleepReanalyzeCorrection.trim()) && styles.modalBtnDisabled]}
                            onPress={async () => {
                              const correction = sleepReanalyzeCorrection.trim();
                              if (!correction || !entry.extraction) return;
                              setSleepReanalyzingId(entry.extraction.id);
                              try {
                                await reanalyzeSleepExtraction(entry.extraction.id, correction);
                                setSleepReanalyzeExtId(null);
                                setSleepReanalyzeCorrection("");
                                load();
                                const fresh = await getSleepExtractions(addDays(today, -14), today).catch(() => []);
                                setSleepExtractions(fresh ?? []);
                              } catch (e) {
                                Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.reanalyzeFailed"));
                              } finally {
                                setSleepReanalyzingId(null);
                              }
                            }}
                            disabled={sleepReanalyzingId !== null || !sleepReanalyzeCorrection.trim()}
                          >
                            {sleepReanalyzingId === entry.extraction.id ? (
                              <ActivityIndicator size="small" color="#0f172a" />
                            ) : (
                              <Text style={styles.modalBtnSaveText}>{t("wellness.sendToAnalysis")}</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={glassCardStyle}>
            {workoutFitness ? (
              <>
                <Text style={[styles.fitnessMetricsLine, { color: colors.text, marginBottom: 4 }]}>
                  CTL {workoutFitness.ctl.toFixed(1)} · ATL {workoutFitness.atl.toFixed(1)} · TSB {workoutFitness.tsb.toFixed(1)}
                </Text>
                <Text style={[styles.fitnessCaption, { color: colors.textMuted, marginBottom: 12 }]}>{t("fitness.dateLabel")} {workoutFitness.date}</Text>
              </>
            ) : (wellnessToday?.ctl != null || wellnessToday?.atl != null || wellnessToday?.tsb != null) ? (
              <>
                <Text style={[styles.fitnessMetricsLine, { color: colors.text, marginBottom: 4 }]}>
                  CTL {wellnessToday?.ctl?.toFixed(1) ?? "—"} · ATL {wellnessToday?.atl?.toFixed(1) ?? "—"} · TSB {wellnessToday?.tsb?.toFixed(1) ?? "—"}
                </Text>
                <Text style={[styles.fitnessCaption, styles.fitnessCaptionMuted, { color: colors.textMuted, marginBottom: 12 }]}>{t("fitness.fromWellness")}</Text>
              </>
            ) : (
              <Text style={[styles.placeholder, styles.fitnessPlaceholder, { color: colors.textMuted, marginBottom: 12 }]}>{t("fitness.placeholder")}</Text>
            )}
            <View style={styles.fitnessFooter}>
              <Text style={[styles.fitnessHint, { color: colors.textMuted, marginBottom: 10 }]}>{t("fitness.hint")}</Text>
              <View style={styles.fitnessButtonsRow}>
                {onOpenIntervals ? (
                  <TouchableOpacity
                    onPress={onOpenIntervals}
                    style={[styles.fitnessBtnBase, styles.fitnessBtnOutline]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.fitnessBtnOutlineText, { color: colors.primary }]}>Intervals.icu</Text>
                  </TouchableOpacity>
                ) : null}
                {onSyncIntervals ? (
                  <TouchableOpacity
                    onPress={async () => {
                      setIntervalsSyncLoading(true);
                      try {
                        const result = await onSyncIntervals();
                        const activities = result?.activities_synced ?? 0;
                        const wellness = result?.wellness_days_synced ?? 0;
                        const message =
                          activities > 0 || wellness > 0
                            ? `Синхронизировано: ${activities} тренировок, ${wellness} дн. wellness.`
                            : t("dashboard.syncDoneNoData");
                        Alert.alert(t("dashboard.syncIntervalsTitle"), message);
                      } catch (e) {
                        Alert.alert(t("common.error"), e instanceof Error ? e.message : t("dashboard.syncFailed"));
                      } finally {
                        setIntervalsSyncLoading(false);
                      }
                    }}
                    disabled={intervalsSyncLoading}
                    style={[styles.fitnessBtnBase, styles.fitnessBtnPrimary, intervalsSyncLoading && styles.fitnessBtnDisabled]}
                    accessibilityRole="button"
                  >
                    {intervalsSyncLoading ? (
                      <ActivityIndicator size="small" color="#0f172a" />
                    ) : (
                      <Text style={styles.fitnessBtnPrimaryText}>{t("fitness.sync")}</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          {entryToEdit ? (
            <EditFoodEntryModal
              entry={entryToEdit}
              copyTargetDate={nutritionDate}
              onClose={() => setEntryToEdit(null)}
              onSaved={() => {
                setEntryToEdit(null);
                loadNutritionForDate(nutritionDate);
              }}
              onDeleted={() => {
                setEntryToEdit(null);
                loadNutritionForDate(nutritionDate);
              }}
            />
          ) : null}

          {wellnessEditVisible ? (
            <EditWellnessModal
              date={today}
              initialWellness={wellnessToday}
              initialWeight={athleteProfile?.weight_kg ?? null}
              onClose={() => setWellnessEditVisible(false)}
              onSaved={() => {
                setWellnessEditVisible(false);
                load();
              }}
            />
          ) : null}

          {workoutAddVisible ? (
            <AddWorkoutModal
              defaultDate={today}
              onClose={() => setWorkoutAddVisible(false)}
              onSaved={() => {
                setWorkoutAddVisible(false);
                load();
              }}
            />
          ) : null}

          {fitPreviewData ? (
            <WorkoutPreviewModal
              file={fitPreviewData.file}
              preview={fitPreviewData.preview}
              onClose={() => setFitPreviewData(null)}
              onSave={onSaveFitFromPreview}
            />
          ) : null}

          {selectedWorkout ? (
            <WorkoutDetailModal
              workout={selectedWorkout}
              onClose={() => setSelectedWorkout(null)}
              onDeleted={load}
            />
          ) : null}

          <View style={glassCardStyle}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>{t("workouts.title")}</Text>
              <View style={styles.cardTitleActions}>
                <TouchableOpacity
                  onPress={onSelectFitFile}
                  disabled={fitUploading}
                  style={fitUploading ? styles.syncBtnDisabled : undefined}
                >
                  {fitUploading ? (
                    <ActivityIndicator size="small" color="#38bdf8" />
                  ) : (
                    <Text style={styles.intervalsLinkText}>{t("workouts.uploadFit")}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setWorkoutAddVisible(true)}>
                  <Text style={styles.intervalsLinkText}>{t("workouts.add")}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.hint}>{t("workouts.hint")}</Text>
            {wellnessToday?.sport_info?.length ? (() => {
              const ride = wellnessToday.sport_info.find((s) => s.type === "Ride") ?? wellnessToday.sport_info[0];
              const eftp = ride?.eftp != null ? Math.round(ride.eftp) : null;
              const pmax = ride?.pMax != null ? Math.round(ride.pMax) : null;
              const show = eftp != null || pmax != null;
              return show ? (
                <Text style={[styles.hint, { marginBottom: 6 }]}>
                  {eftp != null ? `eFTP ${eftp}` : ""}{eftp != null && pmax != null ? " · " : ""}{pmax != null ? `pMax ${pmax}` : ""}
                </Text>
              ) : null;
            })() : null}
            {workouts.length > 0 ? workouts.map((act) => (
              <TouchableOpacity
                key={act.id}
                style={styles.activityRow}
                onPress={() => setSelectedWorkout(act)}
                activeOpacity={0.7}
              >
                <Text style={styles.calendarDate}>{formatEventDate(act.start_date)}</Text>
                <View style={styles.activityInfo}>
                  <Text style={styles.calendarTitle}>{act.name || t("dashboard.workoutFallbackName")}</Text>
                  <Text style={styles.hint}>
                    {formatDuration(act.duration_sec ?? undefined)}
                    {act.distance_m != null ? ` · ${(act.distance_m / 1000).toFixed(1)} km` : ""}
                    {act.tss != null ? ` · TSS ${Math.round(act.tss)}` : ""}
                  </Text>
                </View>
              </TouchableOpacity>
            )) : (
              <Text style={styles.placeholder}>{t("dashboard.noWorkoutsHint")}</Text>
            )}
          </View>

          {athleteProfile?.is_premium ? (
            <>
              {lastAnalysisResult ? (
                <View style={glassCardStyle}>
                  <Text style={styles.cardTitle}>{t("dashboard.analysisResult")}</Text>
                  <Text style={styles.analysisDecision}>{t("dashboard.decisionLabel")} {lastAnalysisResult.decision}</Text>
                  <Text style={styles.value}>{lastAnalysisResult.reason}</Text>
                  {lastAnalysisResult.suggestions_next_days ? (
                    <Text style={[styles.hint, styles.analysisSuggestions]}>{lastAnalysisResult.suggestions_next_days}</Text>
                  ) : null}
                  {lastAnalysisResult.evening_tips ? (
                    <>
                      <Text style={[styles.cardTitle, { marginTop: 12, marginBottom: 4 }]}>{t("dashboard.eveningTips")}</Text>
                      <Text style={[styles.hint, styles.analysisSuggestions]}>{lastAnalysisResult.evening_tips}</Text>
                    </>
                  ) : null}
                  {lastAnalysisResult.plan_tomorrow ? (
                    <>
                      <Text style={[styles.cardTitle, { marginTop: 12, marginBottom: 4 }]}>{t("dashboard.planTomorrow")}</Text>
                      <Text style={[styles.hint, styles.analysisSuggestions]}>{lastAnalysisResult.plan_tomorrow}</Text>
                    </>
                  ) : null}
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.analysisBtn, analysisLoading && styles.analysisBtnDisabled]}
                onPress={onRunAnalysisNow}
                disabled={analysisLoading}
              >
                {analysisLoading ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Text style={styles.analysisBtnText}>{t("dashboard.runAnalysis")}</Text>
                )}
              </TouchableOpacity>
            </>
          ) : null}

        </>
      )}
      </View>
      </ScrollView>
      <View style={styles.fabWrapper}>
        <LinearGradient colors={["#3b82f6", "#8b5cf6"]} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={styles.fabTouchable} onPress={onOpenCamera} activeOpacity={0.9}>
          <Text style={styles.fabLabel}>📷</Text>
          <Text style={styles.fabText}>{t("dashboard.photo")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  scrollView: { flex: 1 },
  userRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  userActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerSeparator: { fontSize: 14, color: "#64748b" },
  userEmail: { fontSize: 14, color: "#b8c5d6", flex: 1, marginRight: 12 },
  logoutText: { fontSize: 14, color: "#38bdf8" },
  content: { padding: 20, paddingBottom: 120 },
  contentWrap: { maxWidth: 960, width: "100%", alignSelf: "center" as const },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 },
  menuIconBtn: { padding: 8 },
  menuIcon: { fontSize: 24, color: "#38bdf8", fontWeight: "700" },
  brandHeader: { marginBottom: 8 },
  brandTitle: { fontSize: 18, fontWeight: "700", color: "#eee", marginBottom: 0 },
  brandAlpha: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  brandSubtitle: { fontSize: 13, color: "#94a3b8" },
  title: { fontSize: 24, fontWeight: "700", color: "#eee", marginBottom: 20 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#eee", marginTop: 8, marginBottom: 12 },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-start", alignItems: "flex-end", paddingTop: 50, paddingRight: 16, paddingHorizontal: 20 },
  menuBox: {
    minWidth: 260,
    borderRadius: 24,
    padding: 24,
    backgroundColor: "rgba(30, 30, 30, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  menuHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  menuHeaderLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  menuEmail: { fontSize: 12, color: "#888888", flex: 1 },
  proBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  proBadgeText: { fontSize: 12, fontWeight: "700" },
  menuCloseBtn: { padding: 4 },
  menuCloseIcon: { fontSize: 20, color: "#94a3b8", fontWeight: "600" },
  menuBackBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 8, marginBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  menuItemIcon: { marginRight: 12 },
  menuItemText: { fontSize: 16, color: "#E0E0E0", flex: 1 },
  menuItemChevron: { marginLeft: 4 },
  loader: { marginTop: 40 },
  skeletonWrap: { gap: 12 },
  skeletonCard: { backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: 24, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.1)" },
  skeletonTitle: { width: "60%", height: 14, backgroundColor: "#334155", borderRadius: 4, marginBottom: 12 },
  skeletonLine: { width: "100%", height: 12, backgroundColor: "#334155", borderRadius: 4, marginBottom: 8 },
  skeletonLineShort: { width: "80%", height: 12, backgroundColor: "#334155", borderRadius: 4 },
  cardBase: { marginBottom: 16 },
  cardTitle: { fontSize: 16, color: "#b8c5d6", marginBottom: 6 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 0 },
  cardTitleActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitleLink: { paddingVertical: 4, paddingLeft: 8 },
  syncBtn: {
    backgroundColor: "#38bdf8",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  syncBtnDisabled: { opacity: 0.7 },
  syncBtnText: { fontSize: 14, color: "#0f172a", fontWeight: "600" },
  value: { fontSize: 18, color: "#e2e8f0", fontWeight: "600" },
  cardValue: { fontSize: 22, fontWeight: "700", color: "#e2e8f0", marginBottom: 8, letterSpacing: 0.5 },
  placeholder: { fontSize: 16, color: "#94a3b8" },
  hint: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
  disclaimer: { fontSize: 11, color: "#64748b", marginTop: 2 },
  hintRemaining: { fontSize: 12, color: "#94a3b8", marginTop: 8 },
  weeklySleepLine: { fontSize: 14, color: "#e2e8f0", marginTop: 8 },
  sleepHistoryRowText: { fontSize: 14, color: "#e2e8f0", marginTop: 0 },
  calendarLink: { marginBottom: 8, paddingVertical: 4 },
  intervalsActionsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  intervalsLinkText: { fontSize: 14, color: "#38bdf8" },
  outlineButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  outlineButtonText: { fontSize: 14, color: "#38bdf8", fontWeight: "600" },
  wellnessMetricsLine: { fontSize: 24, fontWeight: "700", color: "#e2e8f0", letterSpacing: 0.5 },
  sleepReminderBanner: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  sleepReminderText: { fontSize: 14, color: "#94a3b8", marginBottom: 10 },
  sleepReminderButtons: { flexDirection: "row", gap: 10 },
  sleepReminderBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#334155",
  },
  sleepReminderBtnText: { fontSize: 14, color: "#38bdf8", fontWeight: "600" },
  fitnessFooter: { marginTop: 2 },
  fitnessButtonsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  fitnessBtnBase: {
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    flexBasis: 160,
    maxWidth: 240,
  },
  fitnessBtnOutline: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    backgroundColor: "transparent",
  },
  fitnessBtnOutlineText: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  fitnessBtnPrimary: {
    backgroundColor: "#38bdf8",
  },
  fitnessBtnPrimaryText: { fontSize: 14, fontWeight: "700", color: "#0f172a", textAlign: "center" },
  fitnessBtnDisabled: { opacity: 0.7 },
  fitnessHint: { fontSize: 12, marginTop: 2, marginBottom: 10 },
  fitnessMetricsBlock: { marginTop: 2 },
  fitnessMetricsLine: { fontSize: 24, fontWeight: "700", lineHeight: 32, letterSpacing: 0.5 },
  fitnessCaption: { fontSize: 12, marginTop: 4 },
  fitnessCaptionMuted: { fontStyle: "italic" },
  fitnessPlaceholder: { marginTop: 4 },
  errorHint: { fontSize: 12, color: "#f87171", marginBottom: 4 },
  dateNavBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  dateNavBtnActive: { backgroundColor: "#38bdf8" },
  dateNavText: { fontSize: 12, color: "#b8c5d6" },
  dateNavTextActive: { color: "#0f172a", fontWeight: "600" },
  mealRow: { marginTop: 2, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  mealLine: { fontSize: 14, color: "#e2e8f0", flex: 1 },
  mealRowIcon: { marginLeft: 0 },
  deleteAction: { backgroundColor: "#dc2626", justifyContent: "center", alignItems: "center", paddingHorizontal: 16, marginTop: 2, borderRadius: 8 },
  deleteActionText: { color: "#fff", fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalBox: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 24,
    padding: 20,
    maxWidth: 400,
    width: "100%",
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  modalTitle: { fontSize: 18, fontWeight: "600", color: "#e2e8f0", marginBottom: 12 },
  modalScroll: { maxHeight: 320 },
  modalLabel: { fontSize: 12, color: "#b8c5d6", marginTop: 8, marginBottom: 4 },
  modalInput: {
    backgroundColor: "#2a2a40",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#e2e8f0",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    marginBottom: 12,
  },
  mealTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 12 },
  mealTypeBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#1a1a2e" },
  mealTypeBtnActive: { backgroundColor: "#38bdf8" },
  mealTypeBtnText: { fontSize: 12, color: "#94a3b8" },
  mealTypeBtnTextActive: { fontSize: 12, color: "#0f172a", fontWeight: "600" },
  micronutrientsBlock: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#1e293b", borderRadius: 8 },
  micronutrientRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  micronutrientLabel: { fontSize: 12, color: "#94a3b8" },
  micronutrientValue: { fontSize: 12, color: "#e2e8f0" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#334155" },
  modalActionsColumn: { flexDirection: "column", gap: 10, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#334155" },
  modalBtnCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalBtnCancelText: { fontSize: 16, color: "#b8c5d6" },
  modalBtnDelete: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#dc2626" },
  modalBtnDeleteText: { fontSize: 16, color: "#fff", fontWeight: "600" },
  modalBtnSave: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#38bdf8" },
  modalBtnSaveText: { fontSize: 16, color: "#0f172a", fontWeight: "600" },
  modalBtnCopy: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#475569" },
  modalBtnCopyText: { fontSize: 16, color: "#e2e8f0", fontWeight: "600" },
  modalBtnDisabled: { opacity: 0.7 },
  deleteConfirmBox: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#334155" },
  deleteConfirmTitle: { fontSize: 16, fontWeight: "600", color: "#e2e8f0", marginBottom: 4 },
  deleteConfirmMessage: { fontSize: 14, color: "#94a3b8", marginBottom: 12 },
  deleteConfirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  calendarRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 12 },
  calendarDate: { fontSize: 12, color: "#94a3b8", minWidth: 72 },
  calendarTitle: { fontSize: 14, color: "#e2e8f0", flex: 1 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 10, gap: 12 },
  activityInfo: { flex: 1 },
  analysisDecision: { fontSize: 14, color: "#38bdf8", fontWeight: "600", marginBottom: 6 },
  analysisSuggestions: { marginTop: 8, fontStyle: "italic" },
  analysisBtn: {
    marginTop: 12,
    backgroundColor: "#38bdf8",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  analysisBtnDisabled: { opacity: 0.7 },
  analysisBtnText: { fontSize: 16, color: "#0f172a", fontWeight: "600" },
  chatLink: { marginTop: 16, paddingVertical: 12 },
  chatLinkText: { fontSize: 16, color: "#38bdf8" },
  fabWrapper: {
    position: "absolute",
    bottom: 24,
    left: 20,
    borderRadius: 28,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  fabTouchable: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  fabLabel: { fontSize: 22 },
  fabText: { fontSize: 16, color: "#fff", fontWeight: "600" },
});
