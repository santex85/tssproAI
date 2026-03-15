import React from "react";
import { View, Text, Platform, StyleProp, ViewStyle, TextStyle } from "react-native";
import type { SleepExtractionResponse, SleepExtractedData } from "../../api/client";
import { PhotoPreview } from "./PhotoPreview";
import { ResultActions } from "./ResultActions";

function SleepDataLines({
  data,
  styles,
}: {
  data: SleepExtractedData;
  styles: { hint: StyleProp<TextStyle>; sleepLines: StyleProp<ViewStyle>; sleepLine: StyleProp<TextStyle> };
}) {
  const lines: string[] = [];
  if (data.date != null) lines.push(`Date: ${data.date}`);
  if (data.sleep_periods?.length) {
    data.sleep_periods.forEach((p) => lines.push(`Period: ${p}`));
  }
  if (data.bedtime != null || data.wake_time != null) {
    lines.push([data.bedtime, data.wake_time].filter(Boolean).join(" → "));
  }
  if (data.sleep_hours != null) lines.push(`Sleep: ${data.sleep_hours}h`);
  if (data.actual_sleep_hours != null) lines.push(`Actual sleep: ${data.actual_sleep_hours}h`);
  if (data.sleep_minutes != null && data.sleep_hours == null) lines.push(`Sleep: ${data.sleep_minutes} min`);
  if (data.time_in_bed_min != null) lines.push(`Time in bed: ${data.time_in_bed_min} min`);
  if (data.quality_score != null) {
    const delta = data.score_delta != null ? ` (${data.score_delta >= 0 ? "+" : ""}${data.score_delta})` : "";
    lines.push(`Quality: ${data.quality_score}${delta}`);
  }
  if (data.efficiency_pct != null) lines.push(`Efficiency: ${data.efficiency_pct}%`);
  if (data.deep_sleep_min != null) lines.push(`Deep: ${data.deep_sleep_min} min`);
  if (data.rem_min != null) lines.push(`REM: ${data.rem_min} min`);
  if (data.light_sleep_min != null) lines.push(`Light: ${data.light_sleep_min} min`);
  if (data.awake_min != null) lines.push(`Awake: ${data.awake_min} min`);
  if (data.latency_min != null) lines.push(`Latency: ${data.latency_min} min`);
  if (data.awakenings != null) lines.push(`Awakenings: ${data.awakenings}`);
  if (data.rest_min != null) lines.push(`Rest: ${data.rest_min} min`);
  if (data.factor_ratings && Object.keys(data.factor_ratings).length > 0) {
    const factors = Object.entries(data.factor_ratings)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(" · ");
    lines.push(`Factors: ${factors}`);
  }
  if (data.sleep_phases?.length) {
    lines.push(`Phases: ${data.sleep_phases.length} segments`);
    data.sleep_phases.slice(0, 8).forEach((seg) => {
      lines.push(`  ${seg.start}–${seg.end} ${seg.phase}`);
    });
    if (data.sleep_phases.length > 8) {
      lines.push(`  … +${data.sleep_phases.length - 8} more`);
    }
  }
  if (data.source_app != null) lines.push(`Source: ${data.source_app}`);
  if (data.raw_notes != null) lines.push(data.raw_notes);
  if (lines.length === 0) return <Text style={styles.hint}>No metrics extracted.</Text>;
  return (
    <View style={styles.sleepLines}>
      {lines.map((line, i) => (
        <Text key={i} style={styles.sleepLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export interface SleepResultStyles {
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

export interface SleepResultProps {
  previewUri: string | null;
  imageLoaded: boolean;
  onImageLoad: () => void;
  sleep: SleepExtractionResponse;
  isPreview: boolean;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  saving: boolean;
  t: (key: string) => string;
  styles: SleepResultStyles;
}

export function SleepResult({
  previewUri,
  imageLoaded,
  onImageLoad,
  sleep,
  isPreview,
  onSave,
  onCancel,
  onClose,
  saving,
  t,
  styles,
}: SleepResultProps) {
  return (
    <View style={[styles.result, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]}>
      <PhotoPreview
        uri={previewUri}
        imageLoaded={imageLoaded}
        onLoadEnd={onImageLoad}
        styles={styles}
      />
      <Text style={styles.resultName}>{t("camera.sleepRecognized")}</Text>
      <SleepDataLines data={sleep.extracted_data} styles={styles} />
      <Text style={styles.resultWhere}>
        {isPreview ? t("camera.checkAndSave") : t("camera.savedClose")}
      </Text>
      <ResultActions
        isPreview={isPreview}
        saving={saving}
        onSave={onSave}
        onCancel={onCancel}
        onClose={onClose}
        t={t}
        styles={styles}
      />
    </View>
  );
}
