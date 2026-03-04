import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useTranslation } from "../i18n";

type PremiumGateModalProps = {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  /** If true, show "limit reached" message; else show generic "upgrade required" */
  limitReached?: boolean;
};

export function PremiumGateModal({
  visible,
  onClose,
  onUpgrade,
  limitReached = false,
}: PremiumGateModalProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const message = limitReached ? t("pricing.limitReached") : t("pricing.upgradeRequired");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {!visible ? null : (
      <Pressable style={[styles.backdrop, { backgroundColor: colors.modalBackdrop }]} onPress={onClose}>
        <Pressable style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "22" }]}>
            <Ionicons name="lock-open-outline" size={40} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{t("pricing.pro")}</Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.buttonSecondary, { borderColor: colors.glassBorder }]}
              onPress={onClose}
            >
              <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>{t("common.close")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonPrimary, { backgroundColor: colors.primary }]}
              onPress={onUpgrade}
            >
              <Text style={[styles.buttonPrimaryText, { color: colors.primaryText }]}>{t("pricing.upgradeCta")}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  box: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  message: { fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  buttons: { flexDirection: "row", gap: 12, width: "100%" },
  buttonSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  buttonSecondaryText: { fontSize: 16, fontWeight: "600" },
  buttonPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonPrimaryText: { fontSize: 16, fontWeight: "600" },
});
