import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, contentWrap } from "../theme";
import { useTranslation } from "../i18n";
import {
  getBillingStatus,
  createPortalSession,
  type BillingStatus as BillingStatusType,
} from "../api/client";

function getPortalReturnUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/?portal=return`;
  }
  return "https://example.com/?portal=return";
}

function openUrl(url: string): void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = url;
  } else {
    Linking.openURL(url).catch(() => {});
  }
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

export function BillingScreen({
  onClose,
  onOpenPricing,
}: {
  onClose: () => void;
  onOpenPricing?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [status, setStatus] = useState<BillingStatusType | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBillingStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const returnUrl = getPortalReturnUrl();
      const { url } = await createPortalSession(returnUrl);
      if (url) {
        openUrl(url);
      } else {
        Alert.alert(t("common.error"), "No portal URL returned.");
      }
    } catch (e) {
      Alert.alert(t("common.error"), getErrorMessage(e));
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={[styles.header, { borderBottomColor: colors.glassBorder }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.closeText, { color: colors.primary }]}>{t("common.close")}</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{t("billing.title")}</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isPremium = status?.plan === "Premium";
  const photoLimit = status?.photo_analyses_limit ?? null;
  const chatLimit = status?.chat_messages_limit ?? null;
  const photoUsed = status?.photo_analyses_used ?? 0;
  const chatUsed = status?.chat_messages_used ?? 0;
  const showPhotoLimit = photoLimit != null && photoLimit > 0;
  const showChatLimit = chatLimit != null && chatLimit > 0;
  const chatLimitTitleStyle = [styles.sectionTitle, styles.sectionTitleSecond, { color: colors.text }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: colors.glassBorder }]}>
        <TouchableOpacity onPress={onClose}>
          <Text style={[styles.closeText, { color: colors.primary }]}>{t("common.close")}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t("billing.title")}</Text>
      </View>
      <ScrollView style={[styles.scroll, contentWrap]} contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("pricing.currentPlan")}</Text>
          <View style={styles.planRow}>
            <Ionicons
              name={isPremium ? "checkmark-circle" : "person-outline"}
              size={24}
              color={isPremium ? colors.success : colors.textMuted}
            />
            <Text style={[styles.planLabel, { color: colors.text }]}>
              {isPremium ? t("billing.planPremium") : t("billing.planFree")}
            </Text>
          </View>
          {isPremium && status?.current_period_end && (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t("billing.nextBilling")}: {new Date(status.current_period_end).toLocaleDateString()}
            </Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("billing.photoLimit")}</Text>
          {showPhotoLimit ? (
            <View style={styles.limitRow}>
              <View style={styles.progressWrap}>
                <View
                  style={[
                    styles.progressBar,
                    {
                      width: `${Math.min(100, (photoUsed / photoLimit!) * 100)}%`,
                      backgroundColor: colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.limitText, { color: colors.textMuted }]}>
                {photoUsed} / {photoLimit}
              </Text>
            </View>
          ) : (
            <Text style={[styles.unlimitedText, { color: colors.success }]}>{t("billing.unlimited")}</Text>
          )}

          <Text style={chatLimitTitleStyle}>
            {t("billing.chatLimit")}
          </Text>
          {showChatLimit ? (
            <View style={styles.limitRow}>
              <View style={styles.progressWrap}>
                <View
                  style={[
                    styles.progressBar,
                    {
                      width: `${Math.min(100, (chatUsed / chatLimit!) * 100)}%`,
                      backgroundColor: colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.limitText, { color: colors.textMuted }]}>
                {chatUsed} / {chatLimit}
              </Text>
            </View>
          ) : (
            <Text style={[styles.unlimitedText, { color: colors.success }]}>{t("billing.unlimited")}</Text>
          )}
        </View>

        <View style={styles.actions}>
          {!isPremium && onOpenPricing && (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={onOpenPricing}
            >
              <Text style={[styles.buttonText, { color: colors.primaryText }]}>
                {t("billing.upgradeToPremium")}
              </Text>
            </TouchableOpacity>
          )}
          {(isPremium || status?.subscription_status) && (
            <TouchableOpacity
              style={[styles.buttonSecondary, { borderColor: colors.primary }]}
              onPress={handleManageSubscription}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.buttonSecondaryText, { color: colors.primary }]}>
                  {t("billing.manageSubscription")}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
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
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  sectionTitleSecond: { marginTop: 16 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  planLabel: { fontSize: 17, fontWeight: "600" },
  hint: { fontSize: 13, marginTop: 6 },
  limitRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  progressWrap: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  progressBar: { height: "100%", borderRadius: 4 },
  limitText: { fontSize: 14, minWidth: 48 },
  unlimitedText: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  actions: { gap: 12, marginTop: 8 },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  buttonSecondary: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  buttonSecondaryText: { fontSize: 16, fontWeight: "600" },
});
