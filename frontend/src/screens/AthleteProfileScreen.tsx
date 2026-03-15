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
  Platform,
  Linking,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getAthleteProfile,
  updateAthleteProfile,
  updateMyPremium,
  getSubscription,
  createPortalSession,
  type AthleteProfileResponse,
} from "../api/client";
import { useTranslation, type Locale } from "../i18n";
import { useTheme, contentWrap } from "../theme";

const LOCALES: Locale[] = ["ru", "en", "de", "fr", "es", "it", "pt", "th"];
const POPULAR_TIMEZONES = [
  "Europe/Moscow",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Bangkok",
  "Australia/Sydney",
  "UTC",
];
const SETTINGS_LANG_KEYS: Record<Locale, string> = {
  ru: "settings.langRu",
  en: "settings.langEn",
  de: "settings.langDe",
  fr: "settings.langFr",
  es: "settings.langEs",
  it: "settings.langIt",
  pt: "settings.langPt",
  th: "settings.langTh",
};

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

export function AthleteProfileScreen({
  onClose,
  onOpenPricing,
  onOpenBilling,
}: {
  onClose: () => void;
  onOpenPricing?: () => void;
  onOpenBilling?: () => void;
}) {
  const { t, locale, setLocale } = useTranslation();
  const { colors } = useTheme();
  const [profile, setProfile] = useState<AthleteProfileResponse | null>(null);
  const [languageDropdownVisible, setLanguageDropdownVisible] = useState(false);
  const [timezoneDropdownVisible, setTimezoneDropdownVisible] = useState(false);
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
  const [targetRaceName, setTargetRaceName] = useState("");
  const [targetRaceDate, setTargetRaceDate] = useState("");
  const [isAthlete, setIsAthlete] = useState<boolean | null>(null);
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
      setTargetRaceName(p.target_race_name ?? "");
      setTargetRaceDate(p.target_race_date ?? "");
      setIsAthlete(p.is_athlete ?? null);
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
        target_race_date?: string | null;
        target_race_name?: string | null;
        is_athlete?: boolean | null;
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
      if (targetRaceName.trim() !== "") {
        payload.target_race_name = targetRaceName.trim();
      } else {
        payload.target_race_name = null;
      }
      if (targetRaceDate.trim() !== "") {
        const dateMatch = targetRaceDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateMatch) {
          const [, y, m, d] = dateMatch;
          const year = parseInt(y!, 10);
          const month = parseInt(m!, 10);
          const day = parseInt(d!, 10);
          if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            payload.target_race_date = `${y}-${m}-${d}`;
          }
        }
      } else {
        payload.target_race_date = null;
      }
      payload.is_athlete = isAthlete;
      const updated = await updateAthleteProfile(payload);
      setProfile(updated);
      setEditing(false);
    } catch (e) {
      Alert.alert(t("common.error"), getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={[styles.header, { borderBottomColor: colors.surfaceBorder }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.closeText, { color: colors.primary }]}>{t("common.close")}</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{t("athleteProfile.title")}</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={[styles.scroll, contentWrap]}>
        <View style={[styles.header, { borderBottomColor: colors.surfaceBorder }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.closeText, { color: colors.primary }]}>{t("common.close")}</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{t("athleteProfile.title")}</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.displayName, { color: colors.text }]}>{profile?.display_name ?? "—"}</Text>

        {profile?.dev_can_toggle_premium ? (
          <View style={styles.premiumRow}>
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.premiumTestLabel")}</Text>
            <Switch
              value={profile?.is_premium ?? false}
              onValueChange={async (value) => {
                setPremiumToggling(true);
                try {
                  await updateMyPremium(value);
                  setProfile((p) => (p ? { ...p, is_premium: value } : p));
                } catch (e) {
                  Alert.alert(t("common.error"), getErrorMessage(e));
                } finally {
                  setPremiumToggling(false);
                }
              }}
              disabled={premiumToggling}
              trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>
        ) : null}

        {(onOpenPricing || onOpenBilling) ? (
          <View style={styles.subscriptionSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{subscription?.is_premium ? t("athleteProfile.subscriptionPro") : t("athleteProfile.subscription")}</Text>
            {onOpenBilling ? (
              <TouchableOpacity style={[styles.subscriptionBtn, { backgroundColor: colors.glassBg }]} onPress={onOpenBilling}>
                <Text style={[styles.subscriptionBtnText, { color: colors.primary }]}>{t("billing.title")}</Text>
              </TouchableOpacity>
            ) : subscription?.has_subscription ? (
              <TouchableOpacity
                style={[styles.subscriptionBtn, { backgroundColor: colors.glassBg }]}
                onPress={async () => {
                  setPortalLoading(true);
                  try {
                    const base = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://example.com";
                    const { url } = await createPortalSession(`${base}/?portal=return`);
                    if (url) {
                      if (Platform.OS === "web" && typeof window !== "undefined") {
                        window.location.href = url;
                      } else {
                        Linking.openURL(url).catch(() => {});
                      }
                    }
                  } catch (e) {
                    Alert.alert(t("common.error"), getErrorMessage(e));
                  } finally {
                    setPortalLoading(false);
                  }
                }}
                disabled={portalLoading}
              >
                {portalLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={[styles.subscriptionBtnText, { color: colors.primary }]}>{t("pricing.manageSubscription")}</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.subscriptionBtn, { backgroundColor: colors.glassBg }]} onPress={onOpenPricing}>
                <Text style={[styles.subscriptionBtnText, { color: colors.primary }]}>{t("pricing.upgradeCta")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <View style={styles.userTypeSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("athleteProfile.isAthlete")}</Text>
          <View style={styles.segmentRow}>
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                { backgroundColor: colors.glassBg, borderColor: colors.glassBorder },
                isAthlete === true && { backgroundColor: colors.primary },
              ]}
              onPress={async () => {
                if (isAthlete === true) return;
                setIsAthlete(true);
                try {
                  const updated = await updateAthleteProfile({ is_athlete: true });
                  setProfile(updated);
                } catch (e) {
                  Alert.alert(t("common.error"), getErrorMessage(e));
                  setIsAthlete(profile?.is_athlete ?? null);
                }
              }}
            >
              <Text style={[
                styles.segmentBtnText,
                { color: colors.textMuted },
                isAthlete === true && { color: colors.primaryText, fontWeight: "600" as const },
              ]}>
                {t("athleteProfile.userTypeAthlete")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                { backgroundColor: colors.glassBg, borderColor: colors.glassBorder },
                isAthlete === false && { backgroundColor: colors.primary },
              ]}
              onPress={async () => {
                if (isAthlete === false) return;
                setIsAthlete(false);
                try {
                  const updated = await updateAthleteProfile({ is_athlete: false });
                  setProfile(updated);
                } catch (e) {
                  Alert.alert(t("common.error"), getErrorMessage(e));
                  setIsAthlete(profile?.is_athlete ?? null);
                }
              }}
            >
              <Text style={[
                styles.segmentBtnText,
                { color: colors.textMuted },
                isAthlete === false && { color: colors.primaryText, fontWeight: "600" as const },
              ]}>
                {t("athleteProfile.userTypeRegular")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                { backgroundColor: colors.glassBg, borderColor: colors.glassBorder },
                isAthlete === null && { backgroundColor: colors.primary },
              ]}
              onPress={async () => {
                if (isAthlete === null) return;
                setIsAthlete(null);
                try {
                  const updated = await updateAthleteProfile({ is_athlete: null });
                  setProfile(updated);
                } catch (e) {
                  Alert.alert(t("common.error"), getErrorMessage(e));
                  setIsAthlete(profile?.is_athlete ?? null);
                }
              }}
            >
              <Text style={[
                styles.segmentBtnText,
                { color: colors.textMuted },
                isAthlete === null && { color: colors.primaryText, fontWeight: "600" as const },
              ]}>
                {t("athleteProfile.userTypeAuto")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.languageSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("settings.language")}</Text>
          <TouchableOpacity
            style={[styles.languageTrigger, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
            onPress={() => setLanguageDropdownVisible(true)}
          >
            <Text style={[styles.languageLabel, { color: colors.text }]}>{t(SETTINGS_LANG_KEYS[locale])}</Text>
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Modal
          visible={languageDropdownVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setLanguageDropdownVisible(false)}
        >
          <Pressable
            style={[styles.languageModalBackdrop, { backgroundColor: colors.modalBackdrop }, Platform.OS === "web" && { backdropFilter: "blur(4px)" }]}
            onPress={() => setLanguageDropdownVisible(false)}
          >
            <Pressable
              style={[styles.languageModalCard, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={[styles.languageModalTitle, { color: colors.text }]}>{t("settings.language")}</Text>
              {LOCALES.map((loc) => (
                <TouchableOpacity
                  key={loc}
                  style={[
                    styles.languageModalRow,
                    loc === locale && { backgroundColor: colors.glassBg },
                  ]}
                  onPress={async () => {
                    if (loc === locale) {
                      setLanguageDropdownVisible(false);
                      return;
                    }
                    setLocale(loc);
                    setLanguageDropdownVisible(false);
                    try {
                      await updateAthleteProfile({ locale: loc });
                      setProfile((p) => (p ? { ...p, locale: loc } : p));
                    } catch {
                      // locale already updated in UI and API client
                    }
                  }}
                >
                  <Text style={[styles.languageModalLabel, { color: colors.text }]}>{t(SETTINGS_LANG_KEYS[loc])}</Text>
                  {loc === locale && <Text style={[styles.languageModalCheck, { color: colors.primary }]}>✓</Text>}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.languageModalClose} onPress={() => setLanguageDropdownVisible(false)}>
                <Text style={[styles.languageModalCloseText, { color: colors.textMuted }]}>{t("common.close")}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        <View style={styles.languageSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("settings.timezone")}</Text>
          <TouchableOpacity
            style={[styles.languageTrigger, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
            onPress={() => setTimezoneDropdownVisible(true)}
          >
            <Text style={[styles.languageLabel, { color: colors.text }]}>
              {profile?.timezone ?? t("settings.timezoneNotSet")}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Modal
          visible={timezoneDropdownVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setTimezoneDropdownVisible(false)}
        >
          <Pressable
            style={[styles.languageModalBackdrop, { backgroundColor: colors.modalBackdrop }, Platform.OS === "web" && { backdropFilter: "blur(4px)" }]}
            onPress={() => setTimezoneDropdownVisible(false)}
          >
            <Pressable
              style={[styles.languageModalCard, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={[styles.languageModalTitle, { color: colors.text }]}>{t("settings.timezone")}</Text>
              {[
                ...(profile?.timezone && !POPULAR_TIMEZONES.includes(profile.timezone) ? [profile.timezone] : []),
                ...POPULAR_TIMEZONES,
              ].map((tz) => (
                <TouchableOpacity
                  key={tz}
                  style={[
                    styles.languageModalRow,
                    profile?.timezone === tz && { backgroundColor: colors.glassBg },
                  ]}
                  onPress={async () => {
                    setTimezoneDropdownVisible(false);
                    try {
                      const updated = await updateAthleteProfile({ timezone: tz });
                      setProfile((p) => (p ? { ...p, timezone: updated.timezone ?? tz } : p));
                    } catch (e) {
                      Alert.alert(t("common.error"), getErrorMessage(e));
                    }
                  }}
                >
                  <Text style={[styles.languageModalLabel, { color: colors.text }]}>{tz}</Text>
                  {profile?.timezone === tz && <Text style={[styles.languageModalCheck, { color: colors.primary }]}>✓</Text>}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.languageModalClose} onPress={() => setTimezoneDropdownVisible(false)}>
                <Text style={[styles.languageModalCloseText, { color: colors.textMuted }]}>{t("common.close")}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {editing ? (
          <>
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.weightKg")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
              value={weight}
              onChangeText={setWeight}
              placeholder="e.g. 70"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.height")} (cm)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
              value={height}
              onChangeText={setHeight}
              placeholder="e.g. 175"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.birthYear")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
              value={birthYear}
              onChangeText={setBirthYear}
              placeholder="e.g. 1990"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.ftp")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
              value={ftp}
              onChangeText={setFtp}
              placeholder={t("athleteProfile.ftpPlaceholder")}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("athleteProfile.targetRace")}</Text>
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.targetRaceName")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
              value={targetRaceName}
              onChangeText={setTargetRaceName}
              placeholder="e.g. Ironman Barcelona"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
            <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.targetRaceDate")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
              value={targetRaceDate}
              onChangeText={setTargetRaceDate}
              placeholder={t("athleteProfile.targetRaceDatePlaceholder")}
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("athleteProfile.nutritionGoals")}</Text>
            <View style={styles.segmentRow}>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  { backgroundColor: colors.glassBg, borderColor: colors.glassBorder },
                  nutritionInputMode === "calories" && { backgroundColor: colors.primary },
                ]}
                onPress={() => setNutritionInputMode("calories")}
              >
                <Text style={[
                  styles.segmentBtnText,
                  { color: colors.textMuted },
                  nutritionInputMode === "calories" && { color: colors.primaryText, fontWeight: "600" as const },
                ]}>
                  {t("athleteProfile.setCalories")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  { backgroundColor: colors.glassBg, borderColor: colors.glassBorder },
                  nutritionInputMode === "bju" && { backgroundColor: colors.primary },
                ]}
                onPress={() => setNutritionInputMode("bju")}
              >
                <Text style={[
                  styles.segmentBtnText,
                  { color: colors.textMuted },
                  nutritionInputMode === "bju" && { color: colors.primaryText, fontWeight: "600" as const },
                ]}>
                  {t("athleteProfile.setBju")}
                </Text>
              </TouchableOpacity>
            </View>
            {nutritionInputMode === "calories" ? (
              <>
                <Text style={[styles.label, { color: colors.textMuted }]}>{t("athleteProfile.caloriesPerDay")}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
                  value={calorieGoal}
                  onChangeText={setCalorieGoal}
                  placeholder={String(DEFAULT_CALORIE_GOAL)}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                />
                {(() => {
                  const kcal = parseFloat(calorieGoal);
                  const valid = !Number.isNaN(kcal) && kcal >= 0;
                  const { protein, fat, carbs } = valid ? bjuFromCalories(kcal) : { protein: 0, fat: 0, carbs: 0 };
                  return (
                    <>
                      <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.proteinLabel")}</Text>
                      <Text style={[styles.valueReadOnly, { color: colors.textMuted }]}>{valid ? protein : "—"} {t("athleteProfile.gramsShort")}</Text>
                      <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.fatLabel")}</Text>
                      <Text style={[styles.valueReadOnly, { color: colors.textMuted }]}>{valid ? fat : "—"} {t("athleteProfile.gramsShort")}</Text>
                      <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.carbsLabel")}</Text>
                      <Text style={[styles.valueReadOnly, { color: colors.textMuted }]}>{valid ? carbs : "—"} {t("athleteProfile.gramsShort")}</Text>
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.proteinLabel")} ({t("athleteProfile.gramsShort")})</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
                  value={proteinGoal}
                  onChangeText={setProteinGoal}
                  placeholder={String(DEFAULT_PROTEIN_GOAL)}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                />
                <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.fatLabel")} ({t("athleteProfile.gramsShort")})</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
                  value={fatGoal}
                  onChangeText={setFatGoal}
                  placeholder={String(DEFAULT_FAT_GOAL)}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                />
                <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.carbsLabel")} ({t("athleteProfile.gramsShort")})</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
                  value={carbsGoal}
                  onChangeText={setCarbsGoal}
                  placeholder={String(DEFAULT_CARBS_GOAL)}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                />
                {(() => {
                  const p = parseFloat(proteinGoal) || 0;
                  const f = parseFloat(fatGoal) || 0;
                  const c = parseFloat(carbsGoal) || 0;
                  const kcal = caloriesFromBju(p, f, c);
                  return (
                    <>
                      <Text style={[styles.label, { color: colors.textMuted }]}>{t("nutrition.caloriesLabel")}</Text>
                      <Text style={[styles.valueReadOnly, { color: colors.textMuted }]}>≈ {kcal} {t("nutrition.kcal")}</Text>
                    </>
                  );
                })()}
              </>
            )}
            <Text style={[styles.hint, { color: colors.textMuted }]}>{t("athleteProfile.profileHint")}</Text>
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.btnSecondary} onPress={() => setEditing(false)}>
                <Text style={[styles.btnSecondaryText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: colors.primary }, saving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator size="small" color={colors.primaryText} /> : <Text style={[styles.btnPrimaryText, { color: colors.primaryText }]}>{t("common.save")}</Text>}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("athleteProfile.athleteData")}</Text>
            <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
              <View style={[styles.row, styles.rowFirst]}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("wellness.weight")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.weight_kg != null ? `${profile.weight_kg} kg` : "—"}</Text>
                  {profile?.weight_source ? <Text style={[styles.source, { color: colors.textMuted }]}>({profile.weight_source})</Text> : null}
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>FTP</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.ftp != null ? `${profile.ftp} W` : "—"}</Text>
                  {profile?.ftp_source ? <Text style={[styles.source, { color: colors.textMuted }]}>({profile.ftp_source})</Text> : null}
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("athleteProfile.height")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.height_cm != null ? `${profile.height_cm} cm` : "—"}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("athleteProfile.birthYear")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.birth_year != null ? profile.birth_year : "—"}</Text>
                </View>
              </View>
            </View>
            {(profile?.target_race_name || profile?.target_race_date) ? (
              <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                <Text style={[styles.sectionTitleInCard, { color: colors.text }]}>{t("athleteProfile.targetRace")}</Text>
                <View style={[styles.row, styles.rowFirst]}>
                  <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("athleteProfile.targetRaceName")}</Text>
                  <View style={styles.rowValue}>
                    <Text style={[styles.value, { color: colors.text }]}>{profile?.target_race_name ?? "—"}</Text>
                  </View>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("athleteProfile.targetRaceDate")}</Text>
                  <View style={styles.rowValue}>
                    <Text style={[styles.value, { color: colors.text }]}>{profile?.target_race_date ?? "—"}</Text>
                  </View>
                </View>
                {profile?.days_to_race != null && profile.days_to_race >= 0 ? (
                  <View style={styles.row}>
                    <Text style={[styles.value, { color: colors.text }]}>{t("athleteProfile.daysToRace").replace("{days}", String(profile.days_to_race))}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
              <Text style={[styles.sectionTitleInCard, { color: colors.text }]}>{t("athleteProfile.nutritionGoals")}</Text>
              <View style={[styles.row, styles.rowFirst]}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("nutrition.caloriesLabel")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.nutrition_goals?.calorie_goal ?? DEFAULT_CALORIE_GOAL} {t("nutrition.kcal")}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("nutrition.proteinLabel")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.nutrition_goals?.protein_goal ?? DEFAULT_PROTEIN_GOAL} {t("nutrition.grams")}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("nutrition.fatLabel")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.nutrition_goals?.fat_goal ?? DEFAULT_FAT_GOAL} {t("nutrition.grams")}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.labelInRow, { color: colors.textMuted }]}>{t("nutrition.carbsLabel")}</Text>
                <View style={styles.rowValue}>
                  <Text style={[styles.value, { color: colors.text }]}>{profile?.nutrition_goals?.carbs_goal ?? DEFAULT_CARBS_GOAL} {t("nutrition.grams")}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={[styles.editBtn, { borderColor: colors.primary }]} onPress={() => setEditing(true)}>
              <Text style={[styles.editBtnText, { color: colors.primary }]}>{t("athleteProfile.editProfile")}</Text>
            </TouchableOpacity>
          </>
        )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeText: { fontSize: 16 },
  title: { fontSize: 18, fontWeight: "600" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignSelf: "center", marginBottom: 12 },
  displayName: { fontSize: 20, fontWeight: "600", textAlign: "center", marginBottom: 16 },
  hint: { fontSize: 12, marginTop: 4, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginTop: 20, marginBottom: 12 },
  sectionTitleInCard: { fontSize: 16, fontWeight: "600", marginTop: 0, marginBottom: 12 },
  label: { fontSize: 14, marginTop: 12 },
  value: { fontSize: 17, fontWeight: "600" },
  valueReadOnly: { fontSize: 16, marginTop: 6 },
  source: { fontSize: 12, marginLeft: 6 },
  userTypeSection: { marginTop: 20, marginBottom: 8 },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 4 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  segmentBtnText: { fontSize: 14 },
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 10 },
  rowFirst: { marginTop: 0 },
  labelInRow: { fontSize: 14, marginTop: 0 },
  rowValue: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  premiumRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 8 },
  subscriptionSection: { marginTop: 20, marginBottom: 8 },
  subscriptionBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  subscriptionBtnText: { fontSize: 16, fontWeight: "600" },
  languageSection: { marginTop: 20, marginBottom: 8 },
  languageTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  languageLabel: { fontSize: 16, fontWeight: "600" },
  languageModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  languageModalCard: {
    borderRadius: 24,
    padding: 20,
    maxWidth: 320,
    width: "100%",
    borderWidth: 1,
  },
  languageModalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 16 },
  languageModalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  languageModalLabel: { fontSize: 16 },
  languageModalCheck: { fontSize: 16, fontWeight: "600" },
  languageModalClose: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  languageModalCloseText: { fontSize: 16 },
  input: {
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    marginTop: 6,
    borderWidth: 1,
  },
  editActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  btnPrimaryText: { fontSize: 16, fontWeight: "600" },
  btnSecondary: { paddingVertical: 12, paddingHorizontal: 16 },
  btnSecondaryText: { fontSize: 16 },
  btnDisabled: { opacity: 0.7 },
  editBtn: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: "center",
    alignItems: "center",
  },
  editBtnText: { fontSize: 16, fontWeight: "600" },
});
