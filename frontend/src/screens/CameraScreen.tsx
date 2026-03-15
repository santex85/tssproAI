import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import {
  uploadPhotoForAnalysis,
  createNutritionEntry,
  reanalyzeNutritionEntry,
  analyzeNutritionFromText,
  saveSleepFromPreview,
  createOrUpdateWellness,
  createWorkout,
  type NutritionResult,
  type PhotoAnalyzeResponse,
  type EditableNutritionFields,
  type SleepExtractionResponse,
  type WellnessPhotoResult,
  type WorkoutPhotoResult,
} from "../api/client";
import { useTranslation } from "../i18n";
import { useLoadingStages } from "../hooks/useLoadingStages";
import * as Sentry from "@sentry/react-native";
import { devLog, getLogs, clearLogs, subscribe, isDevLogEnabled, type LogEntry } from "../utils/devLog";
import { PremiumGateModal } from "../components/PremiumGateModal";
import { FoodResult, SleepResult, WellnessResult, WorkoutResult } from "../components/camera";

function getPhotoErrorMessage(e: unknown, t: (key: string) => string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  const isNetworkError =
    (e instanceof Error && e.name === "NetworkError") ||
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("no network");
  if (isNetworkError) {
    return t("camera.errorNetwork");
  }
  try {
    const parsed = JSON.parse(msg) as { detail?: string };
    const detail = typeof parsed?.detail === "string" ? parsed.detail : "";
    const detailLower = detail.toLowerCase();
    if (detailLower.includes("valid image") || detailLower.includes("jpeg") || detailLower.includes("png")) {
      return t("camera.errorInvalidFormat");
    }
    if (detailLower.includes("too large") || detailLower.includes("10mb") || detailLower.includes("10 mb")) {
      return t("camera.errorFileTooLarge");
    }
    if (detailLower.includes("limit") || detailLower.includes("429")) {
      return t("camera.errorDailyLimit");
    }
    if (detail) return detail;
  } catch {
    /* ignore */
  }
  return msg || t("camera.errorGeneric");
}

export function CameraScreen({
  onClose,
  onSaved,
  onSleepSaved,
  onWellnessSaved,
  onWorkoutSaved,
  onOpenPricing,
}: {
  onClose: () => void;
  onSaved?: (result: NutritionResult) => void;
  onSleepSaved?: (result: SleepExtractionResponse) => void;
  onWellnessSaved?: (wellness: WellnessPhotoResult, date: string) => void;
  onWorkoutSaved?: () => void;
  onOpenPricing?: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const loadingStageIndex = useLoadingStages(loading, 3, 1600);
  const [saving, setSaving] = useState(false);
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);
  const [photoResult, setPhotoResult] = useState<PhotoAnalyzeResponse | null>(null);
  const [selectedMealType, setSelectedMealType] = useState<string>("other");
  const [editedFood, setEditedFood] = useState<EditableNutritionFields | null>(null);

  const updateEditedFoodField = (
    field: keyof EditableNutritionFields,
    value: string | number
  ) => {
    setEditedFood((prev) =>
      prev
        ? {
            ...prev,
            [field]: field === "name" ? String(value) : Number(value) || 0,
          }
        : null
    );
  };
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [premiumGateVisible, setPremiumGateVisible] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const isPreview = (): boolean => {
    if (!photoResult) return false;
    if (photoResult.type === "food") return (photoResult.food.id ?? 0) === 0;
    if (photoResult.type === "wellness") return true;
    if (photoResult.type === "workout") return true;
    return (photoResult.sleep.id ?? 0) === 0;
  };

  useEffect(() => {
    setLogEntries(getLogs());
    const unsub = subscribe(() => setLogEntries(getLogs()));
    return unsub;
  }, []);

  useEffect(() => {
    setImageLoaded(false);
  }, [selectedPhotoUri]);

  const pickImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("camera.needAccess"), t("camera.needPhotoAccess"));
      return;
    }
    const isNativeApp = Platform.OS !== "web";
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: isNativeApp,
      aspect: isNativeApp ? [1, 1] as [number, number] : undefined,
      quality: 0.8,
    });
    if (pickerResult.canceled) return;
    const asset = pickerResult.assets[0];
    if (!asset?.uri) {
      devLog("pickImage: no asset uri", "warn");
      Alert.alert(t("common.error"), t("camera.getPhotoError"));
      return;
    }
    devLog("pickImage: selected, starting upload (preview)");
    setLoading(true);
    setPhotoResult(null);
    setSelectedPhotoUri(asset.uri);
    try {
      const res = await uploadPhotoForAnalysis(
        { uri: asset.uri, name: "meal.jpg", type: "image/jpeg" },
        undefined,
        false
      );
      devLog("pickImage: upload success");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhotoResult(res);
      if (res?.type === "sleep" && res.sleep?.id != null && res.sleep.id > 0) {
        onSleepSaved?.(res.sleep);
      }
      if (res?.type === "wellness") {
        // Don't call onWellnessSaved here — user may tap Save later; call in handleSave.
      }
      if (res?.type === "food") {
        setSelectedMealType("other");
        setEditedFood({
          name: res.food.name,
          portion_grams: res.food.portion_grams,
          calories: res.food.calories,
          protein_g: res.food.protein_g,
          fat_g: res.food.fat_g,
          carbs_g: res.food.carbs_g,
        });
      } else {
        setEditedFood(null);
      }
    } catch (e) {
      devLog(`pickImage: error ${e instanceof Error ? e.message : String(e)}`, "error");
      const msg = e instanceof Error ? e.message : "";
      if ((msg.includes("429") || msg.includes("limit") || msg.includes("Daily limit")) && onOpenPricing) {
        setPremiumGateVisible(true);
      } else {
        Alert.alert(t("common.error"), getPhotoErrorMessage(e, t));
      }
    } finally {
      setLoading(false);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("camera.needAccess"), t("camera.needCameraAccess"));
      return;
    }
    const isNativeApp = Platform.OS !== "web";
    const pickerResult = await ImagePicker.launchCameraAsync({
      allowsEditing: isNativeApp,
      aspect: isNativeApp ? [1, 1] as [number, number] : undefined,
      quality: 0.8,
    });
    if (pickerResult.canceled) return;
    const asset = pickerResult.assets[0];
    if (!asset?.uri) {
      devLog("takePhoto: no asset uri", "warn");
      Alert.alert(t("common.error"), t("camera.getPhotoError"));
      return;
    }
    devLog("takePhoto: captured, starting upload (preview)");
    setLoading(true);
    setPhotoResult(null);
    setSelectedPhotoUri(asset.uri);
    try {
      const res = await uploadPhotoForAnalysis(
        { uri: asset.uri, name: "meal.jpg", type: "image/jpeg" },
        undefined,
        false
      );
      devLog("takePhoto: upload success");
      setPhotoResult(res);
      if (res?.type === "sleep" && res.sleep?.id != null && res.sleep.id > 0) {
        onSleepSaved?.(res.sleep);
      }
      if (res?.type === "wellness") {
        // Don't call onWellnessSaved here — user may tap Save later; call in handleSave.
      }
      if (res?.type === "food") {
        setSelectedMealType("other");
        setEditedFood({
          name: res.food.name,
          portion_grams: res.food.portion_grams,
          calories: res.food.calories,
          protein_g: res.food.protein_g,
          fat_g: res.food.fat_g,
          carbs_g: res.food.carbs_g,
        });
      } else {
        setEditedFood(null);
      }
    } catch (e) {
      devLog(`takePhoto: error ${e instanceof Error ? e.message : String(e)}`, "error");
      const msg = e instanceof Error ? e.message : "";
      if ((msg.includes("429") || msg.includes("limit") || msg.includes("Daily limit")) && onOpenPricing) {
        setPremiumGateVisible(true);
      } else {
        Alert.alert(t("common.error"), getPhotoErrorMessage(e, t));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!photoResult) return;
    setSaving(true);
    try {
      if (photoResult.type === "food") {
        const today = new Date().toISOString().slice(0, 10);
        const payload = editedFood ?? {
          name: photoResult.food.name,
          portion_grams: photoResult.food.portion_grams,
          calories: photoResult.food.calories,
          protein_g: photoResult.food.protein_g,
          fat_g: photoResult.food.fat_g,
          carbs_g: photoResult.food.carbs_g,
        };
        const entry = await createNutritionEntry({
          ...payload,
          meal_type: selectedMealType,
          date: today,
        });
        const original = photoResult.food;
        const nameOrPortionChanged =
          (payload.name ?? "").trim() !== (original.name ?? "").trim() ||
          payload.portion_grams !== original.portion_grams;
        let finalEntry: typeof entry = entry;
        if (nameOrPortionChanged) {
          try {
            finalEntry = await reanalyzeNutritionEntry(entry.id, {
              name: payload.name.trim() || undefined,
              portion_grams: payload.portion_grams,
            });
          } catch (recalcErr) {
            const msg = recalcErr instanceof Error ? recalcErr.message : String(recalcErr);
            if (msg.includes("403") || msg.includes("Premium")) {
              finalEntry = entry;
            } else {
              throw recalcErr;
            }
          }
        }
        onSaved?.({
          id: finalEntry.id,
          name: finalEntry.name,
          portion_grams: finalEntry.portion_grams,
          calories: finalEntry.calories,
          protein_g: finalEntry.protein_g,
          fat_g: finalEntry.fat_g,
          carbs_g: finalEntry.carbs_g,
        });
      } else if (photoResult.type === "wellness") {
        const d = new Date();
        const todayLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        await createOrUpdateWellness({
          date: todayLocal,
          rhr: photoResult.wellness.rhr ?? undefined,
          hrv: photoResult.wellness.hrv ?? undefined,
        });
        onWellnessSaved?.(photoResult.wellness, todayLocal);
        Alert.alert(t("common.alerts.done"), t("camera.pulseSaved"));
      } else if (photoResult.type === "sleep") {
        if (photoResult.sleep.id != null && photoResult.sleep.id > 0) {
          onSleepSaved?.(photoResult.sleep);
        } else {
          Sentry.addBreadcrumb({ message: "Sleep save: sending POST", category: "api" });
          const saved = await saveSleepFromPreview(photoResult.sleep.extracted_data);
          Sentry.addBreadcrumb({ message: "Sleep save: success", category: "api" });
          onSleepSaved?.(saved);
        }
        Alert.alert(t("common.alerts.done"), t("camera.sleepSaved"));
      } else if (photoResult.type === "workout") {
        const w = photoResult.workout;
        const dateStr = w.date ?? new Date().toISOString().slice(0, 10);
        await createWorkout({
          start_date: `${dateStr}T12:00:00.000Z`,
          name: w.name?.trim() || undefined,
          type: w.sport_type || undefined,
          duration_sec: w.duration_sec ?? undefined,
          distance_m: w.distance_m ?? undefined,
          tss: w.tss ?? undefined,
          notes: w.notes?.trim() || undefined,
        });
        onWorkoutSaved?.();
        Alert.alert(t("common.alerts.done"), t("camera.workoutSaved"));
      }
      setPhotoResult(null);
      setSelectedPhotoUri(null);
      onClose();
    } catch (e) {
      devLog(`handleSave: error ${e instanceof Error ? e.message : String(e)}`, "error");
      const isSleepSave =
        photoResult?.type === "sleep" &&
        (photoResult.sleep.id == null || photoResult.sleep.id === 0);
      if (isSleepSave) {
        Sentry.addBreadcrumb({ message: "Sleep save: failed", category: "api", level: "error" });
        Sentry.captureException(e, {
          tags: { feature: "camera_sleep_save" },
          extra: { step: "saveSleepFromPreview" },
        });
        const err = e as Error;
        const isNetworkError =
          err?.name === "NetworkError" ||
          (err?.message && (err.message.includes("Failed to fetch") || err.message.includes("network") || err.message.includes("No network")));
        if (isNetworkError) {
          Alert.alert(t("common.error"), t("camera.sleepSaveNetworkError"));
          return;
        }
      }
      const message = isSleepSave
        ? `${t("camera.sleepSaveFailed")}: ${getPhotoErrorMessage(e, t)}`
        : getPhotoErrorMessage(e, t);
      Alert.alert(t("common.error"), message);
      setPhotoResult(null);
      setSelectedPhotoUri(null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPhotoResult(null);
    setSelectedPhotoUri(null);
    setEditedFood(null);
  };

  const loadTestImage = async () => {
    const TEST_IMAGE_URL = "https://picsum.photos/id/292/800/600";
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLoading(true);
    setPhotoResult(null);
    setSelectedPhotoUri(TEST_IMAGE_URL);
    try {
      const res = await uploadPhotoForAnalysis(
        { uri: TEST_IMAGE_URL, name: "test-meal.jpg", type: "image/jpeg" },
        undefined,
        false
      );
      devLog("loadTestImage: upload success");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhotoResult(res);
      if (res?.type === "sleep" && res.sleep?.id != null && res.sleep.id > 0) {
        onSleepSaved?.(res.sleep);
      }
      if (res?.type === "food") {
        setSelectedMealType("other");
        setEditedFood({
          name: res.food.name,
          portion_grams: res.food.portion_grams,
          calories: res.food.calories,
          protein_g: res.food.protein_g,
          fat_g: res.food.fat_g,
          carbs_g: res.food.carbs_g,
        });
      } else {
        setEditedFood(null);
      }
    } catch (e) {
      devLog(`loadTestImage: error ${e instanceof Error ? e.message : String(e)}`, "error");
      const msg = e instanceof Error ? e.message : "";
      if ((msg.includes("429") || msg.includes("limit") || msg.includes("Daily limit")) && onOpenPricing) {
        setPremiumGateVisible(true);
      } else {
        Alert.alert(t("common.error"), getPhotoErrorMessage(e, t));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReanalyze = async () => {
    if (!editedFood || photoResult?.type !== "food") return;
    const name = editedFood.name.trim();
    if (!name) {
      Alert.alert(t("common.error"), t("camera.reanalyzeNameRequired"));
      return;
    }
    setReanalyzing(true);
    try {
      const result = await analyzeNutritionFromText({
        name,
        portion_grams: editedFood.portion_grams,
      });
      setEditedFood({
        name: result.name,
        portion_grams: result.portion_grams,
        calories: result.calories,
        protein_g: result.protein_g,
        fat_g: result.fat_g,
        carbs_g: result.carbs_g,
      });
      setPhotoResult((prev) =>
        prev && prev.type === "food"
          ? { ...prev, food: { ...prev.food, ...result, extended_nutrients: result.extended_nutrients ?? prev.food.extended_nutrients } }
          : prev
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("403") || msg.includes("Premium") || msg.includes("premium")) {
        onOpenPricing?.();
        setPremiumGateVisible(true);
      } else {
        Alert.alert(t("common.error"), msg || t("dashboard.recalcFailed"));
      }
    } finally {
      setReanalyzing(false);
    }
  };

  const MEAL_TYPES = [
    { value: "breakfast", label: t("camera.mealBreakfast") },
    { value: "lunch", label: t("camera.mealLunch") },
    { value: "dinner", label: t("camera.mealDinner") },
    { value: "snack", label: t("camera.mealSnack") },
    { value: "other", label: t("camera.mealOther") },
  ] as const;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("camera.photoTitle")}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.close}>{t("common.close")}</Text>
        </TouchableOpacity>
      </View>

      {isDevLogEnabled() && (
        <View style={styles.logPanel}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>Dev log (request/response)</Text>
            <TouchableOpacity onPress={() => { clearLogs(); setLogEntries([]); }}>
              <Text style={styles.logClear}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.logScroll} contentContainerStyle={styles.logScrollContent}>
            {logEntries.length === 0 ? (
              <Text style={styles.logLine}>No logs yet. Choose or take a photo to see request/response.</Text>
            ) : (
              logEntries.map((entry, i) => (
                <Text key={i} style={[styles.logLine, entry.level === "error" && styles.logLineError, entry.level === "warn" && styles.logLineWarn]}>
                  [{entry.ts}] {entry.msg}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      )}

      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainScrollContent}>
        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text style={styles.hint}>
              {[t("camera.stageUpload"), t("camera.stageDetectType"), t("camera.stageAnalyze")][loadingStageIndex]}
            </Text>
          </View>
        )}

        {photoResult?.type === "food" && !loading && (
          <FoodResult
            previewUri={selectedPhotoUri}
            imageLoaded={imageLoaded}
            onImageLoad={() => setImageLoaded(true)}
            food={photoResult.food}
            editedFood={editedFood}
            updateField={updateEditedFoodField}
            selectedMealType={selectedMealType}
            onMealTypeChange={setSelectedMealType}
            mealTypes={MEAL_TYPES}
            isPreview={isPreview()}
            reanalyzing={reanalyzing}
            onReanalyze={handleReanalyze}
            onSave={handleSave}
            onCancel={handleCancel}
            onClose={onClose}
            saving={saving}
            t={t}
            styles={styles}
          />
        )}

        {photoResult?.type === "sleep" && !loading && (
          <SleepResult
            previewUri={selectedPhotoUri}
            imageLoaded={imageLoaded}
            onImageLoad={() => setImageLoaded(true)}
            sleep={photoResult.sleep}
            isPreview={isPreview()}
            onSave={handleSave}
            onCancel={handleCancel}
            onClose={onClose}
            saving={saving}
            t={t}
            styles={styles}
          />
        )}

        {photoResult?.type === "wellness" && !loading && (
          <WellnessResult
            previewUri={selectedPhotoUri}
            imageLoaded={imageLoaded}
            onImageLoad={() => setImageLoaded(true)}
            wellness={photoResult.wellness}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
            t={t}
            styles={styles}
          />
        )}

        {photoResult?.type === "workout" && !loading && (
          <WorkoutResult
            previewUri={selectedPhotoUri}
            imageLoaded={imageLoaded}
            onImageLoad={() => setImageLoaded(true)}
            workout={photoResult.workout}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
            t={t}
            styles={styles}
          />
        )}

        {!photoResult && !loading && (
          <>
            <Text style={styles.flowHint}>
              {t("camera.selectPhotoHint")}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.button, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]} onPress={takePhoto}>
                <Text style={styles.buttonIcon}>📷</Text>
                <Text style={styles.buttonText}>{t("camera.takePhoto")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]} onPress={pickImage}>
                <Text style={styles.buttonIcon}>🖼️</Text>
                <Text style={styles.buttonText}>{t("camera.selectFromGallery")}</Text>
              </TouchableOpacity>
              {isDevLogEnabled() && (
                <TouchableOpacity
                  style={[styles.button, styles.buttonTest, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]}
                  onPress={loadTestImage}
                >
                  <Text style={styles.buttonIcon}>🧪</Text>
                  <Text style={styles.buttonText}>{t("camera.loadTestImage")}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <PremiumGateModal
        visible={premiumGateVisible}
        onClose={() => setPremiumGateVisible(false)}
        onUpgrade={() => { setPremiumGateVisible(false); onOpenPricing?.(); }}
        limitReached
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0D",
    ...(Platform.OS === "web"
      ? { paddingHorizontal: 0, paddingVertical: 12 }
      : { padding: 20 }),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: Platform.OS === "web" ? 16 : 0,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#eee" },
  close: { fontSize: 16, color: "#38bdf8" },
  mainScroll: { flex: 1 },
  mainScrollContent: { paddingBottom: 24 },
  centered: { paddingVertical: 40, alignItems: "center", gap: 12 },
  hint: { fontSize: 14, color: "#94a3b8" },
  flowHint: { fontSize: 13, color: "#64748b", marginBottom: 16 },
  actions: { gap: 16 },
  button: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
  },
  buttonTest: { borderColor: "rgba(148,163,184,0.3)", borderStyle: "dashed" },
  buttonIcon: { fontSize: 40, marginBottom: 8 },
  buttonText: { fontSize: 18, color: "#e2e8f0", fontWeight: "600" },
  result: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    width: "100%",
    alignSelf: "stretch",
    ...(Platform.OS === "web" ? { padding: 16 } : { padding: 20 }),
  },
  photoThumbnailWrap: { width: "100%", height: 180, borderRadius: 8, marginBottom: 12, overflow: "hidden" },
  photoThumbnail: { width: "100%", height: 180, borderRadius: 8 },
  photoPlaceholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  resultName: { fontSize: 20, color: "#e2e8f0", fontWeight: "600", marginBottom: 8 },
  resultMacros: { fontSize: 16, color: "#94a3b8", marginBottom: 4 },
  resultWhere: { fontSize: 12, color: "#64748b", marginTop: 8 },
  sleepLines: { marginVertical: 8, gap: 4 },
  sleepLine: { fontSize: 14, color: "#94a3b8" },
  doneBtn: { marginTop: 20, backgroundColor: "#38bdf8", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  doneBtnText: { fontSize: 16, color: "#0f172a", fontWeight: "600" },
  saveBtn: { marginTop: 12 },
  previewActions: { marginTop: 16, gap: 10 },
  cancelBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#64748b" },
  cancelBtnText: { fontSize: 16, color: "#94a3b8", fontWeight: "600" },
  editLabel: { fontSize: 12, color: "#94a3b8", marginTop: 8, marginBottom: 4 },
  editInput: { backgroundColor: "#1a1a2e", borderRadius: 8, padding: 10, fontSize: 16, color: "#e2e8f0", marginBottom: 4 },
  editRow: { flexDirection: "row", gap: 8 },
  editHalf: { flex: 1 },
  editThird: { flex: 1 },
  mealTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, marginBottom: 8 },
  mealTypeBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#1a1a2e" },
  mealTypeBtnActive: { backgroundColor: "#38bdf8" },
  mealTypeBtnText: { fontSize: 12, color: "#94a3b8" },
  mealTypeBtnTextActive: { fontSize: 12, color: "#0f172a", fontWeight: "600" },
  reanalyzeBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "#1e293b", alignItems: "center" },
  reanalyzeBtnDisabled: { opacity: 0.7 },
  reanalyzeBtnText: { fontSize: 14, color: "#94a3b8", fontWeight: "500" },
  micronutrientsBlock: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  microRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  microLabel: { fontSize: 12, color: "#94a3b8" },
  microValue: { fontSize: 12, color: "#e2e8f0" },
  logPanel: { marginBottom: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, maxHeight: 180, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#334155" },
  logTitle: { fontSize: 12, fontWeight: "600", color: "#94a3b8" },
  logClear: { fontSize: 12, color: "#38bdf8" },
  logScroll: { maxHeight: 140 },
  logScrollContent: { padding: 12 },
  logLine: { fontSize: 11, fontFamily: "monospace", color: "#94a3b8", marginBottom: 2 },
  logLineWarn: { color: "#fbbf24" },
  logLineError: { color: "#f87171" },
});
