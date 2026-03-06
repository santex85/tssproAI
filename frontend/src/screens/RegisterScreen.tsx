import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { register, type AuthUser } from "../api/client";
import { useTranslation } from "../i18n";
import { setAccessToken, setRefreshToken } from "../storage/authStorage";
import { useTheme, contentWrap } from "../theme";

function getErrorMessage(e: unknown, t: (key: string) => string): string {
  if (!(e instanceof Error)) return t("auth.requestError");
  try {
    const parsed = JSON.parse(e.message) as { detail?: string };
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    /* ignore */
  }
  return e.message || t("auth.requestError");
}

const EMAIL_FORMAT_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function RegisterScreen({
  onSuccess,
  onGoToLogin,
}: {
  onSuccess: (user: AuthUser) => void;
  onGoToLogin: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      setError(t("auth.emailRequired"));
      return;
    }
    if (!EMAIL_FORMAT_RE.test(e)) {
      setError(t("auth.invalidEmailFormat"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordMinLength"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await register(e, password);
      await setAccessToken(res.access_token);
      await setRefreshToken(res.refresh_token);
      onSuccess(res.user);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={20}
      >
        <View style={[styles.flex, contentWrap]}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.cardWrapper}>
            <View style={[styles.cardBase, styles.cardForm, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderWidth: 1, borderRadius: colors.borderRadiusLg, padding: 20 }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
            <Text style={[styles.title, { color: colors.text }]}>{t("auth.register")}</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>{t("auth.email")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text }]}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!loading}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>{t("auth.passwordHint")}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              editable={!loading}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.buttonPrimary, { backgroundColor: colors.primary }, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.primaryText} />
              ) : (
                <Text style={[styles.buttonPrimaryText, { color: colors.primaryText }]}>{t("auth.registerCta")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={onGoToLogin} disabled={loading}>
              <Text style={[styles.linkText, { color: colors.primary }]}>{t("auth.haveAccount")}</Text>
            </TouchableOpacity>
          </View>
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", padding: 20 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: 40, paddingBottom: 24 },
  cardWrapper: { width: "100%", alignItems: "center" },
  cardBase: { borderRadius: 24, marginBottom: 24 },
  cardForm: { maxWidth: 400, width: "100%" },
  title: { fontSize: 22, fontWeight: "700", color: "#eee", marginBottom: 20 },
  hint: { fontSize: 14, color: "#94a3b8", marginBottom: 6 },
  input: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#e2e8f0",
    marginBottom: 16,
  },
  error: { fontSize: 14, color: "#f87171", marginBottom: 12 },
  buttonPrimary: {
    backgroundColor: "#38bdf8",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPrimaryText: { fontSize: 16, color: "#0f172a", fontWeight: "600" },
  buttonDisabled: { opacity: 0.7 },
  link: { alignItems: "center", marginTop: 20 },
  linkText: { fontSize: 14, color: "#38bdf8" },
});
