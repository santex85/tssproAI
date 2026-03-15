import React from "react";
import { View, Text, Platform, StyleProp, ViewStyle, TextStyle } from "react-native";
import type { WorkoutPhotoResult } from "../../api/client";
import { PhotoPreview } from "./PhotoPreview";
import { ResultActions } from "./ResultActions";

export interface WorkoutResultStyles {
  result: StyleProp<ViewStyle>;
  photoThumbnailWrap: StyleProp<ViewStyle>;
  photoPlaceholder: StyleProp<ViewStyle>;
  photoThumbnail: StyleProp<ViewStyle>;
  resultName: StyleProp<TextStyle>;
  resultWhere: StyleProp<TextStyle>;
  sleepLines: StyleProp<ViewStyle>;
  sleepLine: StyleProp<TextStyle>;
  doneBtn: StyleProp<ViewStyle>;
  doneBtnText: StyleProp<TextStyle>;
  saveBtn: StyleProp<ViewStyle>;
  previewActions: StyleProp<ViewStyle>;
  cancelBtn: StyleProp<ViewStyle>;
  cancelBtnText: StyleProp<TextStyle>;
}

export interface WorkoutResultProps {
  previewUri: string | null;
  imageLoaded: boolean;
  onImageLoad: () => void;
  workout: WorkoutPhotoResult;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  t: (key: string) => string;
  styles: WorkoutResultStyles;
}

export function WorkoutResult({
  previewUri,
  imageLoaded,
  onImageLoad,
  workout,
  onSave,
  onCancel,
  saving,
  t,
  styles,
}: WorkoutResultProps) {
  return (
    <View style={[styles.result, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]}>
      <PhotoPreview
        uri={previewUri}
        imageLoaded={imageLoaded}
        onLoadEnd={onImageLoad}
        styles={styles}
      />
      <Text style={styles.resultName}>{t("camera.workoutRecognized")}</Text>
      <View style={styles.sleepLines}>
        {workout.name && (
          <Text style={styles.sleepLine}>{workout.name}</Text>
        )}
        {workout.date && (
          <Text style={styles.sleepLine}>{t("dashboard.addWorkoutDateLabel")}: {workout.date}</Text>
        )}
        {workout.sport_type && (
          <Text style={styles.sleepLine}>{t("dashboard.addWorkoutType")}: {workout.sport_type}</Text>
        )}
        {workout.duration_sec != null && (
          <Text style={styles.sleepLine}>
            {t("dashboard.addWorkoutDurationMin")}: {Math.round(workout.duration_sec / 60)} min
          </Text>
        )}
        {workout.distance_m != null && (
          <Text style={styles.sleepLine}>
            {t("dashboard.addWorkoutDistanceKm")}: {(workout.distance_m / 1000).toFixed(2)} km
          </Text>
        )}
        {workout.tss != null && (
          <Text style={styles.sleepLine}>TSS: {Math.round(workout.tss)}</Text>
        )}
        {workout.notes && (
          <Text style={styles.sleepLine}>{workout.notes}</Text>
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
