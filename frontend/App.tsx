import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || "",
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  environment: process.env.EXPO_PUBLIC_APP_ENV || "development",
});

import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  Platform,
  Pressable,
  LogBox,
  useWindowDimensions,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  flushOfflineMutations,
  getMe,
  savePushToken,
  setOnUnauthorized,
  syncIntervals,
  type SleepExtractionResponse,
  type WellnessPhotoResult,
} from "./src/api/client";
import { registerForPushTokenAsync } from "./src/utils/pushNotifications";
import { clearAuth, getAccessToken } from "./src/storage/authStorage";
import { ThemeProvider, useTheme } from "./src/theme";
import { QueryProvider } from "./src/query/provider";
import { useTranslation, I18nProvider } from "./src/i18n";
import type { AuthUser } from "./src/api/client";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ForgotPasswordScreen } from "./src/screens/ForgotPasswordScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { ResetPasswordScreen } from "./src/screens/ResetPasswordScreen";
import { IntervalsCompleteScreen } from "./src/screens/IntervalsCompleteScreen";
import { IntervalsLinkScreen } from "./src/screens/IntervalsLinkScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { AnalyticsScreen } from "./src/screens/AnalyticsScreen";
import { AthleteProfileScreen } from "./src/screens/AthleteProfileScreen";
import { PwaInstallBanner } from "./src/components/PwaInstallBanner";
import { OnboardingGuideModal } from "./src/components/OnboardingGuideModal";
import { useOnboardingGuide } from "./src/hooks/useOnboardingGuide";
import { Ionicons } from "@expo/vector-icons";
import * as Font from "expo-font";

const IONICONS_FONT_URL =
  "https://cdn.jsdelivr.net/npm/react-native-vector-icons@10.0.3/Fonts/Ionicons.ttf";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

if (Platform.OS === "web") {
  LogBox.ignoreLogs(["useNativeDriver"]);
}

// Screen wrappers using require() - dynamic import() fails on Expo web with "unknown module"
function LazyCameraScreen(props: React.ComponentProps<typeof import("./src/screens/CameraScreen").CameraScreen>) {
  const { CameraScreen } = require("./src/screens/CameraScreen");
  return <CameraScreen {...props} />;
}

function LazyPricingScreen(props: { onClose: () => void }) {
  const { PricingScreen } = require("./src/screens/PricingScreen");
  return <PricingScreen {...props} />;
}

function LazyBillingScreen(props: { onClose: () => void; onOpenPricing: () => void; onSyncSuccess?: () => void }) {
  const { BillingScreen } = require("./src/screens/BillingScreen");
  return <BillingScreen {...props} />;
}

function AppContent() {
  const { t } = useTranslation();
  const { colors, mode } = useTheme();
  const isWeb = Platform.OS === "web";
  const { width: windowWidth } = useWindowDimensions();
  const webChromeWidth = isWeb ? Math.max(Math.min(windowWidth - 40, 920), 320) : undefined;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(!isWeb);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [intervalsVisible, setIntervalsVisible] = useState(false);
  const [pricingVisible, setPricingVisible] = useState(false);
  const [billingVisible, setBillingVisible] = useState(false);
  const [refreshNutritionTrigger, setRefreshNutritionTrigger] = useState(0);
  const [refreshSleepTrigger, setRefreshSleepTrigger] = useState(0);
  const [refreshWellnessTrigger, setRefreshWellnessTrigger] = useState(0);
  const [lastSavedSleep, setLastSavedSleep] = useState<SleepExtractionResponse | null>(null);
  const [lastSavedWellness, setLastSavedWellness] = useState<{ date: string } & WellnessPhotoResult | null>(null);
  const [intervalsPendingKey, setIntervalsPendingKey] = useState<string | null>(null);
  const [resetPasswordToken, setResetPasswordToken] = useState<string | null>(null);
  const onboardingGuide = useOnboardingGuide();

  useEffect(() => {
    setOnUnauthorized(() => {
      clearAuth();
      setUser(null);
    });
  }, []);

  useEffect(() => {
    if (!isWeb) return;
    Font.loadAsync({ Ionicons: IONICONS_FONT_URL })
      .then(() => setFontsLoaded(true))
      .catch(() => setFontsLoaded(true));
  }, [isWeb]);

  useEffect(() => {
    getAccessToken()
      .then((token) => {
        if (token) return getMe().then(setUser).catch(() => setUser(null));
        setUser(null);
      })
      .catch(() => setUser(null))
      .finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("intervals_oauth")) {
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
  }, [isWeb]);

  const ready = isReady && (fontsLoaded || !isWeb);

  useEffect(() => {
    if (!ready || !user) return;
    if (!isWeb || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    const refetchAndPoll = async () => {
      await getMe().then(setUser);
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await getMe().then(setUser);
      }
    };
    refetchAndPoll().catch(() => {});
    setBillingVisible(true);
  }, [ready, user, isWeb]);

  useEffect(() => {
    if (!ready || user) return;
    const parseUrl = (url: string | null) => {
      try {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          const pathname = window.location.pathname || "";
          const key = params.get("intervals_pending");
          if (key) {
            setIntervalsPendingKey(key);
            setResetPasswordToken(null);
            window.history.replaceState({}, "", window.location.pathname + window.location.hash);
            return;
          }
          const token = params.get("token");
          if ((pathname === "/reset-password" || pathname.endsWith("/reset-password")) && token) {
            setResetPasswordToken(token);
            setIntervalsPendingKey(null);
            window.history.replaceState({}, "", window.location.pathname + window.location.hash);
            return;
          }
        } else if (url) {
          const pendingMatch = url.match(/[?&]pending=([^&]+)/);
          if (pendingMatch) {
            setIntervalsPendingKey(decodeURIComponent(pendingMatch[1]));
            setResetPasswordToken(null);
            return;
          }
          const resetMatch = url.match(/reset-password[?&]token=([^&]+)/);

          if (resetMatch) {
            setResetPasswordToken(decodeURIComponent(resetMatch[1]));
            setIntervalsPendingKey(null);
          }
        }
      } catch {
        /* ignore */
      }
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      parseUrl(null);
    } else {
      Linking.getInitialURL().then(parseUrl);
      const sub = Linking.addEventListener("url", ({ url }) => parseUrl(url));
      return () => sub.remove();
    }
  }, [ready, user]);

  useEffect(() => {
    if (!user) return;
    flushOfflineMutations().catch(() => {});
    registerForPushTokenAsync()
      .then((token) => {
        if (token) return savePushToken(token, Platform.OS);
      })
      .catch(() => {});
  }, [user]);

  const closeCamera = () => {
    setCameraVisible(false);
    setRefreshNutritionTrigger((t) => t + 1);
  };

  const handleLogout = async () => {
    await clearAuth();
    setUser(null);
  };

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={[styles.root, styles.centered, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>{t("app.loading")}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!user) {
    if (intervalsPendingKey) {
      return (
        <SafeAreaProvider>
          <StatusBar style={mode === "dark" ? "light" : "dark"} />
          <View style={[styles.root, { backgroundColor: colors.background }]}>
            {isWeb && <PwaInstallBanner />}
            <IntervalsCompleteScreen
              pendingKey={intervalsPendingKey}
              onSuccess={(u) => {
                setIntervalsPendingKey(null);
                setUser(u);
              }}
              onError={() => setIntervalsPendingKey(null)}
            />
          </View>
        </SafeAreaProvider>
      );
    }
    if (resetPasswordToken) {
      return (
        <SafeAreaProvider>
          <StatusBar style={mode === "dark" ? "light" : "dark"} />
          <View style={[styles.root, { backgroundColor: colors.background }]}>
            {isWeb && <PwaInstallBanner />}
            <ResetPasswordScreen
              token={resetPasswordToken}
              onSuccess={(u) => {
                setResetPasswordToken(null);
                setUser(u);
              }}
              onGoToLogin={() => setResetPasswordToken(null)}
            />
          </View>
        </SafeAreaProvider>
      );
    }
    return (
        <SafeAreaProvider>
          <StatusBar style={mode === "dark" ? "light" : "dark"} />
          <View style={[styles.root, { backgroundColor: colors.background }]}>
            {isWeb && <PwaInstallBanner />}
            <NavigationContainer>
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                  animation: "fade_from_bottom",
                  animationDuration: 200,
                }}
              >
                <Stack.Screen name="Login">
                {({ navigation }) => (
                  <LoginScreen
                    onSuccess={setUser}
                    onGoToRegister={() => navigation.navigate("Register")}
                    onGoToForgotPassword={() => navigation.navigate("ForgotPassword")}
                  />
                )}
                </Stack.Screen>
                <Stack.Screen name="Register">
                {({ navigation }) => (
                  <RegisterScreen
                    onSuccess={setUser}
                    onGoToLogin={() => navigation.goBack()}
                  />
                )}
                </Stack.Screen>
                <Stack.Screen name="ForgotPassword">
                {({ navigation }) => (
                  <ForgotPasswordScreen
                    onGoToLogin={() => navigation.goBack()}
                  />
                )}
                </Stack.Screen>
              </Stack.Navigator>
            </NavigationContainer>
          </View>
        </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {isWeb && <PwaInstallBanner />}
        <NavigationContainer ref={navigationRef}>
          <Tab.Navigator
            screenOptions={({ route }) => {
              const getIconName = (outline: string, filled: string, focused: boolean) =>
                focused ? filled : outline;
              return {
                headerShown: false,
                tabBarIcon: ({ focused, color, size }) => {
                  let iconName: string;
                  switch (route.name) {
                    case "Home":
                      iconName = getIconName("home-outline", "home", focused);
                      break;
                    case "Chat":
                      iconName = getIconName("chatbubbles-outline", "chatbubbles", focused);
                      break;
                    case "Analytics":
                      iconName = getIconName("stats-chart-outline", "stats-chart", focused);
                      break;
                    case "Profile":
                      iconName = getIconName("person-outline", "person", focused);
                      break;
                    default:
                      iconName = "ellipse-outline";
                  }
                  return <Ionicons name={iconName as any} size={size} color={color} />;
                },
                tabBarStyle: {
                  backgroundColor: colors.glassBg,
                  borderTopWidth: 1,
                  borderTopColor: colors.glassBorder,
                  borderTopLeftRadius: colors.borderRadiusLg,
                  borderTopRightRadius: colors.borderRadiusLg,
                  ...(Platform.OS === "web"
                    ? {
                        backdropFilter: "blur(20px)" as any,
                        width: webChromeWidth,
                        alignSelf: "center" as const,
                      }
                    : {}),
                },
                tabBarActiveTintColor: colors.tabActive,
                tabBarInactiveTintColor: colors.tabInactive,
                animation: "fade",
              };
            }}
          >
            <Tab.Screen
              name="Home"
              options={{ tabBarLabel: t("tabs.home") }}
            >
              {({ navigation }) => (
                <DashboardScreen
                  user={user}
                  onLogout={handleLogout}
                  onOpenCamera={() => setCameraVisible(true)}
                  onOpenChat={() => navigation.navigate("Chat")}
                  onOpenAthleteProfile={() => navigation.navigate("Profile")}
                  onOpenIntervals={() => setIntervalsVisible(true)}
                  onOpenPricing={() => setPricingVisible(true)}
                  onShowOnboardingGuide={onboardingGuide.showAgain}
                  onSyncIntervals={async (clientToday?: string) => {
                    const result = await syncIntervals(clientToday);
                    setRefreshWellnessTrigger((t) => t + 1);
                    return result;
                  }}
                  refreshNutritionTrigger={refreshNutritionTrigger}
                  refreshSleepTrigger={refreshSleepTrigger}
                  refreshWellnessTrigger={refreshWellnessTrigger}
                  lastSavedSleep={lastSavedSleep}
                  onClearLastSavedSleep={() => setLastSavedSleep(null)}
                  lastSavedWellness={lastSavedWellness}
                  onClearLastSavedWellness={() => setLastSavedWellness(null)}
                />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="Chat"
              options={{ tabBarLabel: t("tabs.chat") }}
            >
              {({ navigation }) => (
                <ChatScreen
                  user={user}
                  onClose={() => navigation.navigate("Home")}
                  onOpenPricing={() => setPricingVisible(true)}
                />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="Analytics"
              options={{ tabBarLabel: t("tabs.analytics") }}
            >
              {({ navigation }) => (
                <AnalyticsScreen onClose={() => navigation.navigate("Home")} onOpenPricing={() => setPricingVisible(true)} />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="Profile"
              options={{ tabBarLabel: t("tabs.profile") }}
            >
              {({ navigation }) => (
                <AthleteProfileScreen
                  onClose={() => navigation.navigate("Home")}
                  onOpenPricing={() => setPricingVisible(true)}
                  onOpenBilling={() => setBillingVisible(true)}
                />
              )}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>

        {cameraVisible && (
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <LazyCameraScreen
              onClose={closeCamera}
              onOpenPricing={() => setPricingVisible(true)}
              onSaved={() => {
                setRefreshNutritionTrigger((t) => t + 1);
                setCameraVisible(false);
              }}
              onSleepSaved={(saved) => {
                setLastSavedSleep(saved ?? null);
                setRefreshSleepTrigger((t) => t + 1);
                setRefreshWellnessTrigger((t) => t + 1);
                setCameraVisible(false);
              }}
              onWellnessSaved={(wellness, date) => {
                setLastSavedWellness({ date, ...wellness });
                setRefreshSleepTrigger((t) => t + 1);
                setRefreshWellnessTrigger((t) => t + 1);
                setCameraVisible(false);
              }}
            />
          </View>
        )}

        {intervalsVisible && (
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <IntervalsLinkScreen
              onClose={() => setIntervalsVisible(false)}
              onSynced={() => setRefreshWellnessTrigger((t) => t + 1)}
            />
          </View>
        )}

        {pricingVisible && (
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <LazyPricingScreen onClose={() => setPricingVisible(false)} />
          </View>
        )}

        {billingVisible && (
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <LazyBillingScreen
              onClose={() => setBillingVisible(false)}
              onOpenPricing={() => {
                setBillingVisible(false);
                setPricingVisible(true);
              }}
              onSyncSuccess={() => getMe().then(setUser)}
            />
          </View>
        )}

        {user && onboardingGuide.visible && (
          <OnboardingGuideModal
            visible={onboardingGuide.visible}
            stepIndex={onboardingGuide.stepIndex}
            onClose={onboardingGuide.dismiss}
            onNext={onboardingGuide.goNext}
          />
        )}

      </View>
    </SafeAreaProvider>
  );
}

function ErrorFallback({
  error,
  resetError,
}: {
  error: Error;
  resetError: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.root, styles.centered, { backgroundColor: colors.background }]}>
      <Text style={[styles.loadingText, { color: colors.text }]}>{t("app.errorBoundary")}</Text>
      <Text style={[styles.loadingText, { color: colors.textMuted, fontSize: 12, marginTop: 8 }]} numberOfLines={5}>
        {error?.message}
      </Text>
      <Pressable
        onPress={resetError}
        style={({ pressed }) => [
          { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, backgroundColor: colors.primary, borderRadius: 8, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>{t("app.errorBoundaryBack")}</Text>
      </Pressable>
    </View>
  );
}

function App() {
  return (
    <QueryProvider>
      <ThemeProvider>
        <I18nProvider>
          <Sentry.ErrorBoundary fallback={({ error, resetError }) => <ErrorFallback error={error} resetError={resetError} />}>
            <AppContent />
          </Sentry.ErrorBoundary>
        </I18nProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}

export default Sentry.wrap(App);

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14 },
  modal: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
});
