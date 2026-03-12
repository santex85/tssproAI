import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
  Platform,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getIntervalsOAuthRedirectUrl, getIntervalsStatus, linkIntervals, syncIntervals, unlinkIntervals } from "../api/client";
import { IntervalsIcon } from "../components/IntervalsIcon";
import { useTranslation } from "../i18n";

function getTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getErrorMessage(e: unknown, t: (key: string) => string): string {
  if (!(e instanceof Error)) return t("auth.requestError");
  try {
    const parsed = JSON.parse(e.message) as { detail?: string };
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    /* ignore */
  }
  return e.message || t("auth.requestError");
}

export function IntervalsLinkScreen({ onClose, onSynced }: { onClose: () => void; onSynced?: () => void }) {
  const { t } = useTranslation();
  const [statusLoading, setStatusLoading] = useState(true);
  const [linked, setLinked] = useState(false);
  const [athleteId, setAthleteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [linkedAthleteId, setLinkedAthleteId] = useState<string | null>(null);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const oauthInProgress = useRef(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await getIntervalsStatus();
      setLinked(s.linked);
      setLinkedAthleteId(s.athlete_id ?? null);
      setShowForm(false);
    } catch {
      setLinked(false);
      setLinkedAthleteId(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!oauthInProgress.current) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        oauthInProgress.current = false;
        loadStatus();
      }
    });
    return () => sub.remove();
  }, [loadStatus]);

  const handleOAuthLogin = async () => {
    setOauthLoading(true);
    try {
      const returnApp = Platform.OS !== "web";
      const { redirect_url } = await getIntervalsOAuthRedirectUrl(returnApp);
      oauthInProgress.current = true;
      const opened = await Linking.canOpenURL(redirect_url);
      if (opened) {
        await Linking.openURL(redirect_url);
      } else if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = redirect_url;
      } else {
        Alert.alert(t("common.error"), t("intervals.oauthNotConfigured"));
      }
    } catch (e) {
      oauthInProgress.current = false;
      const msg = getErrorMessage(e, t);
      if (msg.includes("not configured") || msg.includes("503")) {
        Alert.alert(t("common.error"), t("intervals.oauthNotConfigured"));
      } else {
        Alert.alert(t("common.error"), msg);
      }
    } finally {
      setOauthLoading(false);
    }
  };

  const handleLink = async () => {
    const aid = athleteId.trim();
    const key = apiKey.trim();
    if (!aid || !key) {
      Alert.alert(t("common.error"), t("intervals.athleteIdRequired"));
      return;
    }
    setSubmitLoading(true);
    try {
      await linkIntervals(aid, key);
      setAthleteId("");
      setApiKey("");
      await loadStatus();
      Alert.alert(t("common.alerts.done"), t("intervals.linkSuccess") + " " + t("intervals.linkSuccessHint"));
    } catch (e) {
      Alert.alert(t("common.error"), getErrorMessage(e, t));
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncLoading(true);
    try {
      await syncIntervals(getTodayLocal());
      onSynced?.();
      Alert.alert(t("common.alerts.done"), t("intervals.syncSuccess"));
    } catch (e) {
      Alert.alert(t("intervals.syncError"), getErrorMessage(e, t));
    } finally {
      setSyncLoading(false);
    }
  };

  const handleUnlinkConfirm = async () => {
    setUnlinkLoading(true);
    try {
      await unlinkIntervals();
      setShowUnlinkConfirm(false);
      await loadStatus();
      onClose();
    } catch (e) {
      Alert.alert(t("common.error"), getErrorMessage(e, t));
    } finally {
      setUnlinkLoading(false);
    }
  };

  const openIntervalsSettings = () => {
    Linking.openURL("https://www.intervals.icu").catch(() => {});
  };

  if (statusLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>Intervals.icu</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>{t("common.close")}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.hint}>{t("intervals.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Intervals.icu</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.close}>{t("common.close")}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {linked && !showForm ? (
          <View style={[styles.card, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
            <Text style={styles.cardTitle}>{t("intervals.connected")}</Text>
            <Text style={styles.value}>{t("intervals.athleteIdLabel")}: {linkedAthleteId ?? "—"}</Text>
            <TouchableOpacity
              style={[styles.buttonPrimary, syncLoading && styles.buttonDisabled]}
              onPress={handleSync}
              disabled={syncLoading}
            >
              {syncLoading ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text style={styles.buttonPrimaryText}>{t("intervals.sync")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonSecondary} onPress={() => setShowForm(true)}>
              <Text style={styles.buttonSecondaryText}>{t("intervals.titleUpdate")}</Text>
            </TouchableOpacity>
            {showUnlinkConfirm ? (
              <View style={styles.confirmBlock}>
                <Text style={styles.confirmText}>{t("intervals.unlinkConfirmText")}</Text>
                <View style={styles.confirmRow}>
                  <TouchableOpacity
                    style={styles.buttonDanger}
                    onPress={handleUnlinkConfirm}
                    disabled={unlinkLoading}
                  >
                    {unlinkLoading ? (
                      <ActivityIndicator size="small" color="#f87171" />
                    ) : (
                      <Text style={styles.buttonDangerText}>{t("intervals.unlink")}</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.buttonSecondary}
                    onPress={() => setShowUnlinkConfirm(false)}
                    disabled={unlinkLoading}
                  >
                    <Text style={styles.buttonSecondaryText}>{t("common.cancel")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.buttonDanger} onPress={() => setShowUnlinkConfirm(true)}>
                <Text style={styles.buttonDangerText}>{t("intervals.unlink")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {(showForm || !linked) && (
          <View style={[styles.card, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
            <Text style={styles.cardTitle}>{linked ? t("intervals.titleUpdate") : t("intervals.titleLink")}</Text>
            <TouchableOpacity
              style={[styles.oauthButton, oauthLoading && styles.buttonDisabled]}
              onPress={handleOAuthLogin}
              disabled={oauthLoading}
            >
              {oauthLoading ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <>
                  <IntervalsIcon size={20} />
                  <Text style={styles.oauthButtonText}>{t("intervals.loginWithOAuth")}</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={styles.orDivider}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>{t("intervals.orManual")}</Text>
              <View style={styles.orLine} />
            </View>
            <Text style={styles.label}>{t("intervals.athleteIdLabel")}</Text>
            <TextInput
              style={styles.input}
              value={athleteId}
              onChangeText={setAthleteId}
              placeholder={t("intervals.athleteIdPlaceholder")}
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitLoading}
            />
            <Text style={styles.label}>{t("intervals.apiKeyLabel")}</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={t("intervals.apiKeyPlaceholder")}
              placeholderTextColor="#64748b"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitLoading}
            />
            <TouchableOpacity
              style={[styles.buttonPrimary, submitLoading && styles.buttonDisabled]}
              onPress={handleLink}
              disabled={submitLoading}
            >
              {submitLoading ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text style={styles.buttonPrimaryText}>{linked ? t("intervals.save") : t("intervals.connect")}</Text>
              )}
            </TouchableOpacity>
            {linked && showForm && (
              <TouchableOpacity style={styles.buttonSecondary} onPress={() => { setShowForm(false); setAthleteId(""); setApiKey(""); }}>
                <Text style={styles.buttonSecondaryText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={[styles.hintCard, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={styles.hintText}>
            {t("intervals.hint")}
          </Text>
          <TouchableOpacity onPress={openIntervalsSettings}>
            <Text style={styles.link}>{t("intervals.openIntervals")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D", padding: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  title: { fontSize: 22, fontWeight: "700", color: "#eee" },
  close: { fontSize: 16, color: "#38bdf8" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  hint: { fontSize: 14, color: "#94a3b8" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  card: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 24, padding: 20, marginBottom: 16 },
  cardTitle: { fontSize: 14, color: "#94a3b8", marginBottom: 12 },
  value: { fontSize: 16, color: "#e2e8f0", marginBottom: 12 },
  label: { fontSize: 12, color: "#94a3b8", marginBottom: 4 },
  input: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#e2e8f0",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  oauthButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#00a8e8",
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  oauthButtonText: { fontSize: 16, color: "#fff", fontWeight: "600" },
  orDivider: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: "#334155" },
  orText: { marginHorizontal: 12, fontSize: 12, color: "#64748b" },
  buttonPrimary: {
    backgroundColor: "#38bdf8",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPrimaryText: { fontSize: 16, color: "#0f172a", fontWeight: "600" },
  buttonSecondary: { paddingVertical: 12, alignItems: "center", marginTop: 8 },
  buttonSecondaryText: { fontSize: 14, color: "#38bdf8" },
  buttonDanger: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  buttonDangerText: { fontSize: 14, color: "#f87171" },
  buttonDisabled: { opacity: 0.7 },
  confirmBlock: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#334155" },
  confirmText: { fontSize: 14, color: "#94a3b8", marginBottom: 12 },
  confirmRow: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  hintCard: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 24, padding: 20 },
  hintText: { fontSize: 13, color: "#94a3b8", marginBottom: 8 },
  link: { fontSize: 14, color: "#38bdf8" },
});
