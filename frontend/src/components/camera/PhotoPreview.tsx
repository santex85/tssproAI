import React from "react";
import { View, Image, ActivityIndicator, StyleProp, ViewStyle } from "react-native";

interface PhotoPreviewProps {
  uri: string | null;
  imageLoaded: boolean;
  onLoadEnd: () => void;
  styles: {
    photoThumbnailWrap: StyleProp<ViewStyle>;
    photoPlaceholder: StyleProp<ViewStyle>;
    photoThumbnail: StyleProp<ViewStyle>;
  };
}

export function PhotoPreview({ uri, imageLoaded, onLoadEnd, styles }: PhotoPreviewProps) {
  if (!uri) return null;
  return (
    <View style={styles.photoThumbnailWrap}>
      {!imageLoaded && (
        <View style={styles.photoPlaceholder}>
          <ActivityIndicator size="small" color="#64748b" />
        </View>
      )}
      <Image
        source={{ uri }}
        style={styles.photoThumbnail as object}
        resizeMode="cover"
        onLoadEnd={onLoadEnd}
      />
    </View>
  );
}
