import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleProp,
  ViewStyle,
  TextStyle,
} from "react-native";
import type { NutritionResult, EditableNutritionFields } from "../../api/client";
import { PhotoPreview } from "./PhotoPreview";
import { ResultActions } from "./ResultActions";

export interface FoodResultStyles {
  result: StyleProp<ViewStyle>;
  photoThumbnailWrap: StyleProp<ViewStyle>;
  photoPlaceholder: StyleProp<ViewStyle>;
  photoThumbnail: StyleProp<ViewStyle>;
  resultName: StyleProp<TextStyle>;
  resultMacros: StyleProp<TextStyle>;
  resultWhere: StyleProp<TextStyle>;
  hint: StyleProp<TextStyle>;
  editLabel: StyleProp<TextStyle>;
  editInput: StyleProp<ViewStyle>;
  editRow: StyleProp<ViewStyle>;
  editHalf: StyleProp<ViewStyle>;
  editThird: StyleProp<ViewStyle>;
  mealTypeRow: StyleProp<ViewStyle>;
  mealTypeBtn: StyleProp<ViewStyle>;
  mealTypeBtnActive: StyleProp<ViewStyle>;
  mealTypeBtnText: StyleProp<TextStyle>;
  mealTypeBtnTextActive: StyleProp<TextStyle>;
  reanalyzeBtn: StyleProp<ViewStyle>;
  reanalyzeBtnDisabled: StyleProp<ViewStyle>;
  reanalyzeBtnText: StyleProp<TextStyle>;
  micronutrientsBlock: StyleProp<ViewStyle>;
  microRow: StyleProp<ViewStyle>;
  microLabel: StyleProp<TextStyle>;
  microValue: StyleProp<TextStyle>;
  doneBtn: StyleProp<ViewStyle>;
  doneBtnText: StyleProp<TextStyle>;
  saveBtn: StyleProp<ViewStyle>;
  previewActions: StyleProp<ViewStyle>;
  cancelBtn: StyleProp<ViewStyle>;
  cancelBtnText: StyleProp<TextStyle>;
}

export interface MealTypeOption {
  value: string;
  label: string;
}

export interface FoodResultProps {
  previewUri: string | null;
  imageLoaded: boolean;
  onImageLoad: () => void;
  food: NutritionResult;
  editedFood: EditableNutritionFields | null;
  updateField: (field: keyof EditableNutritionFields, value: string | number) => void;
  selectedMealType: string;
  onMealTypeChange: (value: string) => void;
  mealTypes: readonly MealTypeOption[];
  isPreview: boolean;
  reanalyzing: boolean;
  onReanalyze: () => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  saving: boolean;
  t: (key: string) => string;
  styles: FoodResultStyles;
}

export function FoodResult({
  previewUri,
  imageLoaded,
  onImageLoad,
  food,
  editedFood,
  updateField,
  selectedMealType,
  onMealTypeChange,
  mealTypes,
  isPreview,
  reanalyzing,
  onReanalyze,
  onSave,
  onCancel,
  onClose,
  saving,
  t,
  styles,
}: FoodResultProps) {
  return (
    <View style={[styles.result, Platform.OS === "web" && ({ backdropFilter: "blur(20px)" } as object)]}>
      <PhotoPreview
        uri={previewUri}
        imageLoaded={imageLoaded}
        onLoadEnd={onImageLoad}
        styles={styles}
      />
      {isPreview && editedFood ? (
        <>
          <Text style={styles.editLabel}>{t("camera.nameLabel")}</Text>
          <TextInput
            style={styles.editInput}
            value={editedFood.name}
            onChangeText={(txt) => updateField("name", txt)}
            placeholder={t("camera.dishPlaceholder")}
            placeholderTextColor="#64748b"
          />
          <View style={styles.editRow}>
            <View style={styles.editHalf}>
              <Text style={styles.editLabel}>{t("nutrition.caloriesLabel")}</Text>
              <TextInput
                style={styles.editInput}
                value={String(editedFood.calories)}
                onChangeText={(val) => updateField("calories", val)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#64748b"
              />
            </View>
            <View style={styles.editHalf}>
              <Text style={styles.editLabel}>{t("nutrition.portionG")}</Text>
              <TextInput
                style={styles.editInput}
                value={String(editedFood.portion_grams)}
                onChangeText={(val) => updateField("portion_grams", val)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#64748b"
              />
            </View>
          </View>
          <View style={styles.editRow}>
            <View style={styles.editThird}>
              <Text style={styles.editLabel}>{t("nutrition.proteinShort")}</Text>
              <TextInput
                style={styles.editInput}
                value={String(editedFood.protein_g)}
                onChangeText={(val) => updateField("protein_g", val)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#64748b"
              />
            </View>
            <View style={styles.editThird}>
              <Text style={styles.editLabel}>{t("nutrition.fatShort")}</Text>
              <TextInput
                style={styles.editInput}
                value={String(editedFood.fat_g)}
                onChangeText={(val) => updateField("fat_g", val)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#64748b"
              />
            </View>
            <View style={styles.editThird}>
              <Text style={styles.editLabel}>{t("nutrition.carbsShort")}</Text>
              <TextInput
                style={styles.editInput}
                value={String(editedFood.carbs_g)}
                onChangeText={(val) => updateField("carbs_g", val)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#64748b"
              />
            </View>
          </View>
          <Text style={styles.editLabel}>{t("camera.mealTypeLabel")}</Text>
          <View style={styles.mealTypeRow}>
            {mealTypes.map(({ value, label }) => (
              <TouchableOpacity
                key={value}
                style={[styles.mealTypeBtn, selectedMealType === value && styles.mealTypeBtnActive]}
                onPress={() => onMealTypeChange(value)}
              >
                <Text style={[styles.mealTypeBtnText, selectedMealType === value && styles.mealTypeBtnTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.reanalyzeBtn, reanalyzing && styles.reanalyzeBtnDisabled]}
            onPress={onReanalyze}
            disabled={reanalyzing || saving}
          >
            {reanalyzing ? (
              <ActivityIndicator size="small" color="#0f172a" />
            ) : (
              <Text style={styles.reanalyzeBtnText}>{t("camera.reanalyze")}</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.resultName}>{food.name}</Text>
          <Text style={styles.resultMacros}>
            {food.calories} {t("nutrition.kcal")} · {t("nutrition.proteinShort")} {food.protein_g}
            {t("nutrition.grams")} · {t("nutrition.fatShort")} {food.fat_g}
            {t("nutrition.grams")} · {t("nutrition.carbsShort")} {food.carbs_g}
            {t("nutrition.grams")}
          </Text>
          <Text style={styles.hint}>
            {t("camera.portionLabel")}: {food.portion_grams}
            {t("nutrition.grams")}
          </Text>
        </>
      )}
      {food.extended_nutrients && Object.keys(food.extended_nutrients).length > 0 ? (
        <>
          <Text style={styles.editLabel}>{t("nutrition.micronutrients")}</Text>
          <View style={styles.micronutrientsBlock}>
            {Object.entries(food.extended_nutrients).map(([key, value]) => {
              const labelKey = `nutrition.micronutrientLabels.${key}`;
              const label = t(labelKey) !== labelKey ? t(labelKey) : key;
              return (
                <View key={key} style={styles.microRow}>
                  <Text style={styles.microLabel}>{label}</Text>
                  <Text style={styles.microValue}>
                    {typeof value === "number" ? Math.round(value * 10) / 10 : value}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
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
