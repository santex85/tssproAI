import React from "react";
import { View, Text, Platform, StyleProp, ViewStyle, TextStyle } from "react-native";
import type { WellnessPhotoResult } from "../../api/client";
import { PhotoPreview } from "./PhotoPreview";
import { ResultActions } from "./ResultActions";

export interface WellnessResultStyles {
  result: StyleProp<ViewStyle>;
  photoThumbnailWrap: StyleProp<ViewStyle>;
  photoPlaceholder: StyleProp<ViewStyle>;
  photoThumbnail: StyleProp<ViewStyle>;
  resultName: StyleProp<TextStyle>;
  resultWhere: StyleProp<TextStyle>;
  hint: StyleProp<TextStyle>;
  sleepLines: StyleProp<ViewStyle>;
  sleepLine: StyleProp<TextStyle>;
  doneBtn: StyleProp<ViewStyle>;
  doneBtnText: StyleProp<TextStyle>;
  saveBtn: StyleProp<ViewStyle>;
  previewActions: StyleProp<ViewStyle>;
  cancelBtn: StyleProp<ViewStyle>;
  cancelBtnText: StyleProp<TextStyle>;
}

export interface WellnessResultProps {
  previewUri: string | null;
  imageLoaded: boolean;
  onImageLoad: () => void;
  wellness: WellnessPhotoResult;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  t: (key: string) => string;
  styles: WellnessResultStyles;
}

export function WellnessResult({
  previewUri,
  imageLoaded,
  onImageLoad,
  wellness,
  onSave,
  onCancel,
  saving,
  t,
  styles,
}: WellnessResultProps) {
  return (
    <View style={[styles.result, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]}>
      <PhotoPreview
        uri={previewUri}
        imageLoaded={imageLoaded}
        onLoadEnd={onImageLoad}
        styles={styles}
      />
      <Text style={styles.resultName}>{t("camera.wellnessRecognized")}</Text>
      <View style={styles.sleepLines}>
        {wellness.rhr != null && (
          <Text style={styles.sleepLine}>{t("camera.rhrLabel")}: {wellness.rhr}</Text>
        )}
        {wellness.hrv != null && (
          <Text style={styles.sleepLine}>HRV: {wellness.hrv}</Text>
        )}
        {wellness.rhr == null && wellness.hrv == null && (
          <Text style={styles.hint}>{t("camera.noRhrHrv")}</Text>
        )}
      </View>
      <Text style={styles.resultWhere}>{t("camera.checkAndSave")}</Text>
      <ResultActions
        isPreview={true}
        saving={saving}
        onSave={onSave}
        onCancel={onCancel}
        onClose={() => {}}
        t={t}
        styles={styles}
      />
    </View>
  );
}
