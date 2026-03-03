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
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getAthleteProfile,
  updateAthleteProfile,
  updateMyPremium,
  getSubscription,
  createPortalSession,
  type AthleteProfileResponse,
} from "../api/client";
import { useTranslation } from "../i18n/context";

const DEFAULT_CALORIE_GOAL = 2200;
const DEFAULT_PROTEIN_GOAL = 120;
const DEFAULT_FAT_GOAL = 80;
const DEFAULT_CARBS_GOAL = 250;

/** BJU from calories: 30% protein, 30% fat, 40% carbs (by calories). */
function bjuFromCalories(kcal: number): { protein: number; fat: number; carbs: number } {
  return {
    protein: Math.round((kcal * 0.3) / 4),
    fat: Math.round((kcal * 0.3) / 9),
    carbs: Math.round((kcal * 0.4) / 4),
  };
}

/** Calories from BJU: 4 kcal/g protein, 9 kcal/g fat, 4 kcal/g carbs. */
function caloriesFromBju(protein: number, fat: number, carbs: number): number {
  return Math.round(protein * 4 + fat * 9 + carbs * 4);
}

function getErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "Request failed.";
  try {
    const parsed = JSON.parse(e.message) as { detail?: string };
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    /* ignore */
  }
  return e.message || "Request failed.";
}

export function AthleteProfileScreen({ onClose, onOpenPricing }: { onClose: () => void; onOpenPricing?: () => void }) {
  const { t, locale, setLocale } = useTranslation();
  const [profile, setProfile] = useState<AthleteProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [ftp, setFtp] = useState("");
  const [calorieGoal, setCalorieGoal] = useState("");
  const [proteinGoal, setProteinGoal] = useState("");
  const [fatGoal, setFatGoal] = useState("");
  const [carbsGoal, setCarbsGoal] = useState("");
  const [nutritionInputMode, setNutritionInputMode] = useState<"calories" | "bju">("calories");
  const [premiumToggling, setPremiumToggling] = useState(false);
  const [subscription, setSubscription] = useState<Awaited<ReturnType<typeof getSubscription>> | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, sub] = await Promise.all([
        getAthleteProfile(),
        getSubscription().catch(() => null),
      ]);
      setProfile(p);
      setSubscription(sub ?? null);
      setWeight(p.weight_kg != null ? String(p.weight_kg) : "");
      setHeight(p.height_cm != null ? String(p.height_cm) : "");
      setBirthYear(p.birth_year != null ? String(p.birth_year) : "");
      setFtp(p.ftp != null ? String(p.ftp) : "");
      const g = p.nutrition_goals;
      setCalorieGoal(g?.calorie_goal != null ? String(g.calorie_goal) : String(DEFAULT_CALORIE_GOAL));
      setProteinGoal(g?.protein_goal != null ? String(g.protein_goal) : String(DEFAULT_PROTEIN_GOAL));
      setFatGoal(g?.fat_goal != null ? String(g.fat_goal) : String(DEFAULT_FAT_GOAL));
      setCarbsGoal(g?.carbs_goal != null ? String(g.carbs_goal) : String(DEFAULT_CARBS_GOAL));
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: {
        weight_kg?: number;
        height_cm?: number;
        birth_year?: number;
        ftp?: number;
        calorie_goal?: number;
        protein_goal?: number;
        fat_goal?: number;
        carbs_goal?: number;
      } = {};
      if (weight.trim() !== "") {
        const v = parseFloat(weight);
        if (!Number.isNaN(v) && v > 0) payload.weight_kg = v;
      }
      if (height.trim() !== "") {
        const v = parseFloat(height);
        if (!Number.isNaN(v) && v > 0) payload.height_cm = v;
      }
      if (birthYear.trim() !== "") {
        const v = parseInt(birthYear, 10);
        if (!Number.isNaN(v) && v >= 1900 && v <= 2100) payload.birth_year = v;
      }
      if (ftp.trim() !== "") {
        const v = parseInt(ftp, 10);
        if (!Number.isNaN(v) && v > 0) payload.ftp = v;
      }
      // Build consistent K/B/J/U from current mode and send all four
      if (nutritionInputMode === "calories") {
        const c = parseFloat(calorieGoal);
        if (!Number.isNaN(c) && c >= 0) {
          payload.calorie_goal = c;
          const bju = bjuFromCalories(c);
          payload.protein_goal = bju.protein;
          payload.fat_goal = bju.fat;
          payload.carbs_goal = bju.carbs;
        }
      } else {
        const pr = parseFloat(proteinGoal) || 0;
        const f = parseFloat(fatGoal) || 0;
        const ca = parseFloat(carbsGoal) || 0;
        if (pr >= 0 && f >= 0 && ca >= 0) {
          payload.calorie_goal = caloriesFromBju(pr, f, ca);
          payload.protein_goal = Math.round(pr);
          payload.fat_goal = Math.round(f);
          payload.carbs_goal = Math.round(ca);
        }
      }
      const updated = await updateAthleteProfile(payload);
      setProfile(updated);
      setEditing(false);
    } catch (e) {
      Alert.alert("Ошибка", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Закрыть</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Профиль атлета</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38bdf8" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeText}>Закрыть</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Профиль атлета</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.displayName}>{profile?.display_name ?? "—"}</Text>

        {profile?.dev_can_toggle_premium ? (
          <View style={styles.premiumRow}>
            <Text style={styles.label}>Премиум (для теста)</Text>
            <Switch
              value={profile?.is_premium ?? false}
              onValueChange={async (value) => {
                setPremiumToggling(true);
                try {
                  await updateMyPremium(value);
                  setProfile((p) => (p ? { ...p, is_premium: value } : p));
                } catch (e) {
                  Alert.alert("Ошибка", getErrorMessage(e));
                } finally {
                  setPremiumToggling(false);
                }
              }}
              disabled={premiumToggling}
              trackColor={{ false: "#334155", true: "#38bdf8" }}
              thumbColor="#e2e8f0"
            />
          </View>
        ) : null}

        {onOpenPricing ? (
          <View style={styles.subscriptionSection}>
            <Text style={styles.sectionTitle}>{subscription?.is_premium ? "Подписка Pro" : "Подписка"}</Text>
            {subscription?.has_subscription ? (
              <TouchableOpacity
                style={styles.subscriptionBtn}
                onPress={async () => {
                  setPortalLoading(true);
                  try {
                    const base = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://example.com";
                    const { url } = await createPortalSession(`${base}/?portal=return`);
                    if (url && typeof window !== "undefined") window.location.href = url;
                  } catch (e) {
                    Alert.alert("Ошибка", getErrorMessage(e));
                  } finally {
                    setPortalLoading(false);
                  }
                }}
                disabled={portalLoading}
              >
                {portalLoading ? <ActivityIndicator size="small" color="#38bdf8" /> : <Text style={styles.subscriptionBtnText}>Управление подпиской</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.subscriptionBtn} onPress={onOpenPricing}>
                <Text style={styles.subscriptionBtnText}>Перейти на Pro</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <View style={styles.languageSection}>
          <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
          <TouchableOpacity
            style={styles.languageRow}
            onPress={async () => {
              const next = locale === "ru" ? "en" : "ru";
              setLocale(next);
              try {
                await updateAthleteProfile({ locale: next });
                setProfile((p) => (p ? { ...p, locale: next } : p));
              } catch {
                // locale already updated in UI and API client
              }
            }}
          >
            <Text style={styles.languageLabel}>{locale === "ru" ? t("settings.langRu") : t("settings.langEn")}</Text>
            <Text style={styles.languageHint}>{locale === "ru" ? t("settings.langSwitchToEn") : t("settings.langSwitchToRu")}</Text>
          </TouchableOpacity>
        </View>

        {editing ? (
          <>
            <Text style={styles.label}>Вес (кг)</Text>
            <TextInput
              style={styles.input}
              value={weight}
              onChangeText={setWeight}
              placeholder="e.g. 70"
              placeholderTextColor="#64748b"
              keyboardType="decimal-pad"
            />
            <Text style={styles.label}>Height (cm)</Text>
            <TextInput
              style={styles.input}
              value={height}
              onChangeText={setHeight}
              placeholder="e.g. 175"
              placeholderTextColor="#64748b"
              keyboardType="number-pad"
            />
            <Text style={styles.label}>Birth year</Text>
            <TextInput
              style={styles.input}
              value={birthYear}
              onChangeText={setBirthYear}
              placeholder="e.g. 1990"
              placeholderTextColor="#64748b"
              keyboardType="number-pad"
            />
            <Text style={styles.label}>FTP (watts)</Text>
            <TextInput
              style={styles.input}
              value={ftp}
              onChangeText={setFtp}
              placeholder="Используется для TSS по мощности"
              placeholderTextColor="#64748b"
              keyboardType="number-pad"
            />
            <Text style={styles.sectionTitle}>Цели по питанию</Text>
            <View style={styles.segmentRow}>
              <TouchableOpacity
                style={[styles.segmentBtn, nutritionInputMode === "calories" && styles.segmentBtnActive]}
                onPress={() => setNutritionInputMode("calories")}
              >
                <Text style={[styles.segmentBtnText, nutritionInputMode === "calories" && styles.segmentBtnTextActive]}>
                  Задать калории
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, nutritionInputMode === "bju" && styles.segmentBtnActive]}
                onPress={() => setNutritionInputMode("bju")}
              >
                <Text style={[styles.segmentBtnText, nutritionInputMode === "bju" && styles.segmentBtnTextActive]}>
                  Задать БЖУ
                </Text>
              </TouchableOpacity>
            </View>
            {nutritionInputMode === "calories" ? (
              <>
                <Text style={styles.label}>Калории (ккал/день)</Text>
                <TextInput
                  style={styles.input}
                  value={calorieGoal}
                  onChangeText={setCalorieGoal}
                  placeholder={String(DEFAULT_CALORIE_GOAL)}
                  placeholderTextColor="#64748b"
                  keyboardType="number-pad"
                />
                {(() => {
                  const kcal = parseFloat(calorieGoal);
                  const valid = !Number.isNaN(kcal) && kcal >= 0;
                  const { protein, fat, carbs } = valid ? bjuFromCalories(kcal) : { protein: 0, fat: 0, carbs: 0 };
                  return (
                    <>
                      <Text style={styles.label}>Белки</Text>
                      <Text style={styles.valueReadOnly}>{valid ? protein : "—"} г</Text>
                      <Text style={styles.label}>Жиры</Text>
                      <Text style={styles.valueReadOnly}>{valid ? fat : "—"} г</Text>
                      <Text style={styles.label}>Углеводы</Text>
                      <Text style={styles.valueReadOnly}>{valid ? carbs : "—"} г</Text>
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <Text style={styles.label}>Белки (г)</Text>
                <TextInput
                  style={styles.input}
                  value={proteinGoal}
                  onChangeText={setProteinGoal}
                  placeholder={String(DEFAULT_PROTEIN_GOAL)}
                  placeholderTextColor="#64748b"
                  keyboardType="number-pad"
                />
                <Text style={styles.label}>Жиры (г)</Text>
                <TextInput
                  style={styles.input}
                  value={fatGoal}
                  onChangeText={setFatGoal}
                  placeholder={String(DEFAULT_FAT_GOAL)}
                  placeholderTextColor="#64748b"
                  keyboardType="number-pad"
                />
                <Text style={styles.label}>Углеводы (г)</Text>
                <TextInput
                  style={styles.input}
                  value={carbsGoal}
                  onChangeText={setCarbsGoal}
                  placeholder={String(DEFAULT_CARBS_GOAL)}
                  placeholderTextColor="#64748b"
                  keyboardType="number-pad"
                />
                {(() => {
                  const p = parseFloat(proteinGoal) || 0;
                  const f = parseFloat(fatGoal) || 0;
                  const c = parseFloat(carbsGoal) || 0;
                  const kcal = caloriesFromBju(p, f, c);
                  return (
                    <>
                      <Text style={styles.label}>Калории</Text>
                      <Text style={styles.valueReadOnly}>≈ {kcal} ккал</Text>
                    </>
                  );
                })()}
              </>
            )}
            <Text style={styles.hint}>Введите вес, рост, год рождения, FTP и цели по питанию. Цели используются на дашборде.</Text>
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.btnSecondary} onPress={() => setEditing(false)}>
                <Text style={styles.btnSecondaryText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, saving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator size="small" color="#0f172a" /> : <Text style={styles.btnPrimaryText}>Сохранить</Text>}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Данные атлета</Text>
            <View style={styles.card}>
              <View style={[styles.row, styles.rowFirst]}>
                <Text style={styles.labelInRow}>Вес</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.weight_kg != null ? `${profile.weight_kg} kg` : "—"}</Text>
                  {profile?.weight_source ? <Text style={styles.source}>({profile.weight_source})</Text> : null}
                </View>
              </View>
              <View style={styles.row}>
                <Text style={styles.labelInRow}>FTP</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.ftp != null ? `${profile.ftp} W` : "—"}</Text>
                  {profile?.ftp_source ? <Text style={styles.source}>({profile.ftp_source})</Text> : null}
                </View>
              </View>
              <View style={styles.row}>
                <Text style={styles.labelInRow}>Рост</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.height_cm != null ? `${profile.height_cm} cm` : "—"}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={styles.labelInRow}>Birth year</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.birth_year != null ? profile.birth_year : "—"}</Text>
                </View>
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitleInCard}>Цели по питанию</Text>
              <View style={[styles.row, styles.rowFirst]}>
                <Text style={styles.labelInRow}>Калории</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.nutrition_goals?.calorie_goal ?? DEFAULT_CALORIE_GOAL} ккал</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={styles.labelInRow}>Белки</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.nutrition_goals?.protein_goal ?? DEFAULT_PROTEIN_GOAL} г</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={styles.labelInRow}>Жиры</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.nutrition_goals?.fat_goal ?? DEFAULT_FAT_GOAL} г</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={styles.labelInRow}>Углеводы</Text>
                <View style={styles.rowValue}>
                  <Text style={styles.value}>{profile?.nutrition_goals?.carbs_goal ?? DEFAULT_CARBS_GOAL} г</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
              <Text style={styles.editBtnText}>Редактировать профиль</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0D0D0D" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  closeText: { fontSize: 16, color: "#38bdf8" },
  title: { fontSize: 18, fontWeight: "600", color: "#e2e8f0" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignSelf: "center", marginBottom: 12 },
  displayName: { fontSize: 20, fontWeight: "600", color: "#e2e8f0", textAlign: "center", marginBottom: 16 },
  hint: { fontSize: 12, color: "#64748b", marginTop: 4, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#e2e8f0", marginTop: 20, marginBottom: 12 },
  sectionTitleInCard: { fontSize: 16, fontWeight: "600", color: "#e2e8f0", marginTop: 0, marginBottom: 12 },
  label: { fontSize: 14, color: "#94a3b8", marginTop: 12 },
  value: { fontSize: 17, color: "#e2e8f0", fontWeight: "600" },
  valueReadOnly: { fontSize: 16, color: "#94a3b8", marginTop: 6 },
  source: { fontSize: 12, color: "#64748b", marginLeft: 6 },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 4 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
  },
  segmentBtnActive: { backgroundColor: "#38bdf8" },
  segmentBtnText: { fontSize: 14, color: "#94a3b8" },
  segmentBtnTextActive: { color: "#0f172a", fontWeight: "600" },
  card: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 10 },
  rowFirst: { marginTop: 0 },
  labelInRow: { fontSize: 14, color: "#94a3b8", marginTop: 0 },
  rowValue: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  premiumRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 8 },
  subscriptionSection: { marginTop: 20, marginBottom: 8 },
  subscriptionBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(56, 189, 248, 0.2)",
    borderRadius: 12,
    alignItems: "center",
  },
  subscriptionBtnText: { fontSize: 16, fontWeight: "600", color: "#38bdf8" },
  languageSection: { marginTop: 20, marginBottom: 8 },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginTop: 8,
  },
  languageLabel: { fontSize: 16, fontWeight: "600", color: "#e2e8f0" },
  languageHint: { fontSize: 13, color: "#94a3b8" },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: "#e2e8f0",
    marginTop: 6,
  },
  editActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  btnPrimary: { flex: 1, backgroundColor: "#38bdf8", paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  btnPrimaryText: { fontSize: 16, color: "#0f172a", fontWeight: "600" },
  btnSecondary: { paddingVertical: 12, paddingHorizontal: 16 },
  btnSecondaryText: { fontSize: 16, color: "#94a3b8" },
  btnDisabled: { opacity: 0.7 },
  editBtn: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#38bdf8",
    alignSelf: "center",
    alignItems: "center",
  },
  editBtnText: { fontSize: 16, color: "#38bdf8", fontWeight: "600" },
});
