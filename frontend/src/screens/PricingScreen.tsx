import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, contentWrap } from "../theme";
import { useTranslation } from "../i18n";
import { createCheckoutSession, getSubscription, type BillingPlan } from "../api/client";

function getBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://example.com";
}

export function PricingScreen({
  onClose,
  isPremium,
}: {
  onClose: () => void;
  isPremium?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [loading, setLoading] = useState<BillingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [premium, setPremium] = useState<boolean>(isPremium ?? false);
  useEffect(() => {
    if (isPremium !== undefined) {
      setPremium(isPremium);
      return;
    }
    getSubscription()
      .then((s) => setPremium(s.is_premium))
      .catch(() => {});
  }, [isPremium]);

  const handleCheckout = async (plan: BillingPlan) => {
    setError(null);
    setLoading(plan);
    try {
      const base = getBaseUrl();
      const { url } = await createCheckoutSession(
        plan,
        `${base}/?checkout=success`,
        `${base}/?checkout=cancel`
      );
      if (url && typeof window !== "undefined") {
        window.location.href = url;
        return;
      }
      setError(t("pricing.checkoutError"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.requestError"));
    } finally {
      setLoading(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: colors.glassBorder }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t("pricing.title")}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
          <Ionicons name="close" size={28} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <ScrollView
        style={[styles.scroll, contentWrap]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t("pricing.subtitle")}</Text>

        {premium && (
          <View style={[styles.badge, { backgroundColor: colors.success + "22" }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={[styles.badgeText, { color: colors.success }]}>{t("pricing.pro")}</Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
          <View style={styles.planRow}>
            <Text style={[styles.planName, { color: colors.text }]}>{t("pricing.monthly")}</Text>
            <Text style={[styles.price, { color: colors.primary }]}>{t("pricing.ctaMonthly")}</Text>
          </View>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={() => handleCheckout("monthly")}
            disabled={!!loading || !!premium}
          >
            {loading === "monthly" ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <>
                <Text style={[styles.buttonText, { color: colors.primaryText }]}>
                  {premium ? t("pricing.currentPlan") : t("pricing.upgradeCta")}
                </Text>
                {!premium && (
                  <Text style={[styles.trialBadge, { color: colors.primaryText }]}>
                    {t("pricing.trialBadge")}
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
          <View style={styles.planRow}>
            <Text style={[styles.planName, { color: colors.text }]}>{t("pricing.annual")}</Text>
            <View style={styles.annualPriceRow}>
              <Text style={[styles.price, { color: colors.primary }]}>{t("pricing.ctaAnnual")}</Text>
              <View style={[styles.saveChip, { backgroundColor: colors.accent + "33" }]}>
                <Text style={[styles.saveChipText, { color: colors.accent }]}>
                  {t("pricing.savePercent")}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={() => handleCheckout("annual")}
            disabled={!!loading || !!premium}
          >
            {loading === "annual" ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <>
                <Text style={[styles.buttonText, { color: colors.primaryText }]}>
                  {premium ? t("pricing.currentPlan") : t("pricing.upgradeCta")}
                </Text>
                {!premium && (
                  <Text style={[styles.trialBadge, { color: colors.primaryText }]}>
                    {t("pricing.trialBadge")}
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        </View>

        {error && (
          <View style={[styles.errorBox, { backgroundColor: colors.danger + "22" }]}>
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        )}

        {Platform.OS === "web" && !premium && (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Оплата через Stripe. После подписки вы вернётесь в приложение.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 20, fontWeight: "600" },
  closeBtn: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    marginBottom: 20,
  },
  badgeText: { fontSize: 14, fontWeight: "600" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  planRow: { marginBottom: 12 },
  planName: { fontSize: 16, fontWeight: "600" },
  price: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  annualPriceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  saveChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  saveChipText: { fontSize: 12, fontWeight: "600" },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  trialBadge: { fontSize: 12, marginTop: 4, opacity: 0.9 },
  errorBox: { padding: 12, borderRadius: 12, marginTop: 16 },
  errorText: { fontSize: 14 },
  hint: { fontSize: 12, marginTop: 24, textAlign: "center" },
});
