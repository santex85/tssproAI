import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Platform,
} from "react-native";
import { useTheme } from "../theme";
import { useTranslation } from "../i18n";

const STEPS = [
  { key: "stepFood" as const },
  { key: "stepSleep" as const },
  { key: "stepWellness" as const },
  { key: "stepWorkouts" as const },
] as const;

type OnboardingGuideModalProps = {
  visible: boolean;
  stepIndex: number;
  onClose: () => void;
  onNext: () => void;
};

export function OnboardingGuideModal({
  visible,
  stepIndex,
  onClose,
  onNext,
}: OnboardingGuideModalProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const step = STEPS[Math.min(stepIndex, STEPS.length - 1)];
  const isLast = stepIndex >= STEPS.length - 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {!visible ? null : (
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.modalBackdrop }]}
          onPress={onClose}
        >
          <Pressable
            style={[
              styles.box,
              {
                backgroundColor: colors.surface,
                borderColor: colors.surfaceBorder,
              },
              Platform.OS === "web" && { backdropFilter: "blur(20px)" },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.header}>
              <Text style={[styles.stepIndicator, { color: colors.textMuted }]}>
                {stepIndex + 1} / {STEPS.length}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={12}
                accessibilityLabel={t("guide.close")}
              >
                <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>
                  {t("guide.close")}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>
              {t(`guide.${step.key}.title`)}
            </Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>
              {t(`guide.${step.key}.body`)}
            </Text>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={[styles.buttonSecondary, { borderColor: colors.glassBorder }]}
                onPress={onClose}
              >
                <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>
                  {t("guide.close")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonPrimary, { backgroundColor: colors.primary }]}
                onPress={onNext}
              >
                <Text
                  style={[styles.buttonPrimaryText, { color: colors.primaryText }]}
                >
                  {isLast ? t("guide.done") : t("guide.next")}
                </Text>
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
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  stepIndicator: {
    fontSize: 14,
  },
  closeBtn: {
    padding: 4,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : {}),
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
  },
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
