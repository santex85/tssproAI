import React from "react";
import { View, Text, TouchableOpacity, StyleProp, ViewStyle, TextStyle } from "react-native";

interface ResultActionsProps {
  isPreview: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  t: (key: string) => string;
  styles: {
    doneBtn: StyleProp<ViewStyle>;
    doneBtnText: StyleProp<TextStyle>;
    saveBtn: StyleProp<ViewStyle>;
    previewActions: StyleProp<ViewStyle>;
    cancelBtn: StyleProp<ViewStyle>;
    cancelBtnText: StyleProp<TextStyle>;
  };
}

export function ResultActions({
  isPreview,
  saving,
  onSave,
  onCancel,
  onClose,
  t,
  styles,
}: ResultActionsProps) {
  if (isPreview) {
    return (
      <View style={styles.previewActions}>
        <TouchableOpacity
          style={[styles.doneBtn, styles.saveBtn]}
          onPress={onSave}
          disabled={saving}
        >
          <Text style={styles.doneBtnText}>{saving ? "…" : t("common.save")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.cancelBtnText}>{t("common.cancel")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
      <Text style={styles.doneBtnText}>{t("camera.done")}</Text>
    </TouchableOpacity>
  );
}
