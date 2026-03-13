import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { usePwaInstallPrompt } from "../hooks/usePwaInstallPrompt";
import { useTranslation } from "../i18n";
import { useTheme } from "../theme";

export function PwaInstallBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { shouldShow, promptInstall, dismiss } = usePwaInstallPrompt();

  if (!shouldShow) return null;

  return (
    <View style={[styles.banner, { backgroundColor: colors.background }]}>
      <Text style={[styles.text, { color: colors.text }]} numberOfLines={1}>
        {t("app.installPwa")}
      </Text>
      <Pressable
        onPress={promptInstall}
        style={({ pressed }) => [
          styles.installBtn,
          { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.installBtnText, { color: colors.primaryText }]}>{t("app.install")}</Text>
      </Pressable>
      <Pressable onPress={dismiss} style={styles.dismissBtn} hitSlop={12}>
        <Text style={[styles.dismissText, { color: colors.textMuted }]}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  text: {
    flex: 1,
    fontSize: 14,
  },
  installBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  installBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  dismissBtn: {
    padding: 4,
  },
  dismissText: {
    fontSize: 20,
    lineHeight: 22,
  },
});
