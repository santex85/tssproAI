import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  Pressable,
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getChatHistory,
  sendChatMessage,
  sendChatMessageWithFit,
  sendChatMessageWithImage,
  runOrchestrator,
  getChatThreads,
  createChatThread,
  clearChatThread,
  deleteChatThread,
  updateChatThread,
  type ChatMessage,
  type ChatThreadItem,
} from "../api/client";
import { useTheme } from "../theme";
import { useTranslation } from "../i18n";
import { useLoadingStages } from "../hooks/useLoadingStages";
import { Ionicons } from "@expo/vector-icons";
import { PremiumGateModal } from "../components/PremiumGateModal";
import type { AuthUser } from "../api/client";

function formatChatTime(isoOrTimestamp: string): string {
  try {
    const d = new Date(isoOrTimestamp);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date();
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    if (isToday) {
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ChatScreen({
  user,
  onClose,
  onOpenPricing,
}: {
  user?: AuthUser | null;
  onClose: () => void;
  onOpenPricing?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [threads, setThreads] = useState<ChatThreadItem[]>([]);
  const [premiumGateVisible, setPremiumGateVisible] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachedFit, setAttachedFit] = useState<Blob | { uri: string; name: string } | null>(null);
  const [attachedImage, setAttachedImage] = useState<Blob | { uri: string; name: string } | null>(null);
  const [saveWorkout, setSaveWorkout] = useState(false);
  const isPremium = !!user?.is_premium;
  const [loading, setLoading] = useState(false);
  const loadingStageIndex = useLoadingStages(loading, 3, 1600);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameThreadId, setRenameThreadId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [threadMenuThread, setThreadMenuThread] = useState<ChatThreadItem | null>(null);
  const flatRef = useRef<FlatList>(null);

  const pickFitFile = useCallback(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const inputEl = document.createElement("input");
      inputEl.type = "file";
      inputEl.accept = ".fit";
      inputEl.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        setAttachedFit(file);
      };
      inputEl.click();
      return;
    }
    const openDocPicker = async () => {
      try {
        const { getDocumentAsync } = await import("expo-document-picker");
        const result = await getDocumentAsync({
          type: "*/*",
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const doc = result.assets[0];
        setAttachedFit({ uri: doc.uri, name: doc.name || "workout.fit" });
      } catch (err) {
        Alert.alert(t("common.error"), t("chat.attachFileError"));
      }
    };
    openDocPicker();
  }, [t]);

  const pickImage = useCallback(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const inputEl = document.createElement("input");
      inputEl.type = "file";
      inputEl.accept = "image/*";
      inputEl.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        setAttachedImage(file);
      };
      inputEl.click();
      return;
    }
    const openImagePicker = async () => {
      try {
        const { getDocumentAsync } = await import("expo-document-picker");
        const result = await getDocumentAsync({
          type: "image/*",
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const doc = result.assets[0];
        setAttachedImage({ uri: doc.uri, name: doc.name || "photo.jpg" });
      } catch (err) {
        Alert.alert(t("common.error"), t("chat.attachFileError"));
      }
    };
    openImagePicker();
  }, [t]);

  const loadHistoryForThread = useCallback(async (threadId: number | null) => {
    try {
      const list = await getChatHistory(threadId, 50);
      setMessages(Array.isArray(list) ? list : []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const res = await getChatThreads();
      const nextThreads = res?.items ?? [];
      setThreads(nextThreads);
      if (nextThreads.length === 0) {
        const created = await createChatThread(t("chat.defaultThreadName"));
        setThreads([created]);
        setCurrentThreadId(created.id);
        await loadHistoryForThread(created.id);
      } else {
        const firstId = nextThreads[0].id;
        setCurrentThreadId(firstId);
        setLoadingHistory(true);
        await loadHistoryForThread(firstId);
      }
    } catch {
      setThreads([]);
      setCurrentThreadId(null);
      setMessages([]);
      setLoadingHistory(false);
    }
  }, [loadHistoryForThread, t]);

  useEffect(() => {
    setLoadingHistory(true);
    loadThreads();
  }, []);

  const selectThread = useCallback(
    (threadId: number) => {
      setCurrentThreadId(threadId);
      setLoadingHistory(true);
      loadHistoryForThread(threadId);
    },
    [loadHistoryForThread]
  );

  const onNewChat = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const created = await createChatThread(t("chat.newChat"));
      setThreads((prev) => [created, ...prev]);
      setCurrentThreadId(created.id);
      setMessages([]);
    } catch {
      // ignore
    }
  }, [t]);

  const onClearChat = useCallback(async () => {
    if (currentThreadId == null) return;
    try {
      await clearChatThread(currentThreadId);
      setMessages([]);
    } catch {
      // ignore
    }
  }, [currentThreadId]);

  const performDeleteThread = useCallback(
    async (threadId: number) => {
      try {
        await deleteChatThread(threadId);
        setThreads((prev) => {
          const next = prev.filter((t) => t.id !== threadId);
          if (currentThreadId === threadId) {
            if (next.length > 0) {
              setCurrentThreadId(next[0].id);
              setLoadingHistory(true);
              loadHistoryForThread(next[0].id);
            } else {
              setCurrentThreadId(null);
              setMessages([]);
              createChatThread(t("chat.defaultThreadName")).then((created) => {
                setThreads([created]);
                setCurrentThreadId(created.id);
                loadHistoryForThread(created.id);
              });
            }
          }
          return next;
        });
      } catch (e) {
        const raw = e instanceof Error ? e.message : t("chat.deleteFailed");
        let msg = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.detail === "Not Found" || parsed?.detail === "Thread not found")
            msg = t("common.alerts.recordNotFound");
        } catch {
          if (raw.startsWith("{")) msg = t("common.alerts.serverError");
        }
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert(msg);
        } else {
          Alert.alert(t("common.error"), msg);
        }
      }
    },
    [currentThreadId, loadHistoryForThread, t]
  );

  const onDeleteThread = useCallback(
    (threadId: number, title: string) => {
      const confirmTitle = t("chat.deleteChatConfirmTitle");
      const confirmMessage = t("chat.deleteChatConfirmMessage").replace("{name}", title);
      const runDelete = () => performDeleteThread(threadId);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        if (window.confirm(`${confirmTitle}\n${confirmMessage}`)) {
          runDelete();
        }
      } else {
        Alert.alert(confirmTitle, confirmMessage, [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.delete"), style: "destructive", onPress: runDelete },
        ]);
      }
    },
    [performDeleteThread, t]
  );

  const openThreadMenu = useCallback(
    (thread: ChatThreadItem) => {
      if (Platform.OS === "web") {
        setThreadMenuThread(thread);
        return;
      }
      Alert.alert(t("tabs.chat"), `«${thread.title}»`, [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.rename"),
          onPress: () => {
            setRenameThreadId(thread.id);
            setRenameTitle(thread.title);
            setRenameModalOpen(true);
          },
        },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => onDeleteThread(thread.id, thread.title),
        },
      ]);
    },
    [onDeleteThread, t]
  );

  const onRenameSubmit = useCallback(async () => {
    const id = renameThreadId;
    const title = renameTitle.trim();
    if (id == null || !title) return;
    try {
      await updateChatThread(id, { title });
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
      setRenameModalOpen(false);
      setRenameThreadId(null);
      setRenameTitle("");
    } catch {
      Alert.alert(t("common.error"), t("chat.renameError"));
    }
  }, [renameThreadId, renameTitle, t]);

  const send = async (runOrch = false) => {
    if (runOrch) {
      if (loading) return;
      setMessages((prev) => [...prev, { role: "user", content: t("chat.solutionQuestion") }]);
      setLoading(true);
      try {
        const orch = await runOrchestrator();
        const reply = `Решение: ${orch.decision}. ${orch.reason}${orch.suggestions_next_days ? "\n\n" + orch.suggestions_next_days : ""}`;
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: t("common.error") + ": " + (e instanceof Error ? e.message : t("chat.requestFailed")) },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }
    const text = input.trim();
    if ((!text && !attachedFit && !attachedImage) || loading) return;
    const userContent = text || (attachedImage ? t("chat.photoAttachmentLabel") : t("chat.fitAttachmentLabel"));
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userContent }]);
    if (attachedFit) setAttachedFit(null);
    if (attachedImage) setAttachedImage(null);
    setLoading(true);
    try {
      let reply: string;
      if (attachedImage) {
        const res = await sendChatMessageWithImage(text, attachedImage, currentThreadId ?? undefined);
        reply = res.reply;
      } else if (attachedFit) {
        const res = await sendChatMessageWithFit(text, attachedFit, currentThreadId ?? undefined, saveWorkout);
        reply = res.reply;
      } else {
        const res = await sendChatMessage(text, false, currentThreadId ?? undefined);
        reply = res.reply;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("chat.requestFailed");
      const showPremiumGate =
        (msg.includes("429") || msg.includes("limit") || msg.includes("Daily limit") || msg.includes("403") || msg.includes("Premium") || msg.includes("premium")) &&
        onOpenPricing;
      if (showPremiumGate) {
        setPremiumGateVisible(true);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: t("common.error") + ": " + msg },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  if (loadingHistory) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("chat.title")}</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.close}>{t("common.close")}</Text></TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
    <KeyboardAvoidingView
      style={styles.flex1}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={[styles.header, { backgroundColor: colors.glassBg, borderBottomColor: colors.glassBorder }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t("chat.title")}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onNewChat} style={styles.headerBtn}>
            <Text style={[styles.headerBtnText, { color: colors.textMuted }]}>{t("chat.newChat")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClearChat} style={styles.headerBtn} disabled={currentThreadId == null}>
            <Text style={[styles.headerBtnText, { color: colors.textMuted }]}>{t("chat.clear")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.close, { color: colors.primary }]}>{t("common.close")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {threads.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabsScroll, { backgroundColor: colors.glassBg, borderBottomColor: colors.glassBorder }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}
          contentContainerStyle={styles.tabsContent}
        >
          {threads.map((thread) => (
            <View key={thread.id} style={styles.tabWrap}>
              <TouchableOpacity
                style={[styles.tab, thread.id === currentThreadId && styles.tabActive]}
                onPress={() => selectThread(thread.id)}
                onLongPress={() => openThreadMenu(thread)}
              >
                <Text style={[styles.tabText, thread.id === currentThreadId && styles.tabTextActive]} numberOfLines={1}>
                  {thread.title}
                </Text>
                {thread.id === currentThreadId ? (
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => openThreadMenu(thread)}
                    style={styles.tabMenuBtn}
                  >
                    <Ionicons name="ellipsis-horizontal" size={16} color={thread.id === currentThreadId ? "#0f172a" : colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {loadingHistory ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38bdf8" />
        </View>
      ) : (
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
            {item.timestamp ? (
              <Text style={styles.bubbleTime}>{formatChatTime(item.timestamp)}</Text>
            ) : null}
          </View>
        )}
        ListFooterComponent={
          loading ? (
            <View style={[styles.bubble, styles.assistantBubble, styles.loadingBubble]}>
              <ActivityIndicator size="small" color={colors.primary ?? "#38bdf8"} style={styles.loadingBubbleSpinner} />
              <Text style={styles.bubbleText}>
                {[t("chat.stageProcessing"), t("chat.stageContext"), t("chat.stageWriting")][loadingStageIndex]}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.placeholder}>{t("chat.emptyPrompt")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickPrompts} contentContainerStyle={styles.quickPromptsContent}>
              {[t("chat.quickPrompt1"), t("chat.quickPrompt2"), t("chat.quickPrompt3")].map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  style={styles.quickPromptChip}
                  onPress={() => setInput(prompt)}
                >
                  <Text style={styles.quickPromptText}>{prompt}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
      />
      )}
      {attachedFit ? (
        <View style={[styles.attachedRow, { backgroundColor: colors.glassBg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={styles.attachedText}>{t("chat.attachedFIT")}</Text>
          <TouchableOpacity onPress={() => setAttachedFit(null)} style={styles.attachedRemove}>
            <Text style={styles.attachedRemoveText}>{t("common.remove")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSaveWorkout((v) => !v)}
            style={[styles.saveWorkoutChip, saveWorkout && styles.saveWorkoutChipActive]}
          >
            <Text style={styles.saveWorkoutChipText}>{saveWorkout ? t("chat.addToDiaryDone") : t("chat.addToDiary")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {attachedImage ? (
        <View style={[styles.attachedRow, { backgroundColor: colors.glassBg }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
          <Text style={styles.attachedText}>{t("chat.attachedPhoto")}</Text>
          <TouchableOpacity onPress={() => setAttachedImage(null)} style={styles.attachedRemove}>
            <Text style={styles.attachedRemoveText}>{t("common.remove")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={[styles.inputRow, { backgroundColor: colors.glassBg, borderTopColor: colors.glassBorder }, Platform.OS === "web" && { backdropFilter: "blur(20px)" }]}>
        {isPremium ? (
          <>
            <TouchableOpacity
              onPress={pickFitFile}
              style={styles.attachBtn}
              disabled={loading || loadingHistory}
              accessibilityLabel="FIT"
              accessibilityRole="button"
            >
              <Ionicons name="document-attach-outline" size={22} color={colors.primary ?? "#38bdf8"} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={pickImage}
              style={styles.attachBtn}
              disabled={loading || loadingHistory}
              accessibilityLabel={t("chat.attachPhotoShort")}
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={22} color={colors.primary ?? "#38bdf8"} />
            </TouchableOpacity>
          </>
        ) : null}
        <TextInput
          style={[styles.input, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, color: colors.text }]}
          placeholder={t("chat.placeholder")}
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          editable={!loading && !loadingHistory}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: colors.primary }, (loading || loadingHistory) && styles.sendBtnDisabled]}
          onPress={() => send(false)}
          disabled={loading || loadingHistory || (!input.trim() && !attachedFit && !attachedImage)}
          accessibilityLabel={t("chat.send")}
          accessibilityRole="button"
        >
          <Ionicons name="send" size={20} color={colors.primaryText ?? "#0f172a"} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.orchBtn, loading && styles.sendBtnDisabled]}
        onPress={() => send(true)}
        disabled={loading}
      >
        <Text style={styles.orchBtnText}>{t("chat.solutionToday")}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>

      <Modal visible={renameModalOpen} transparent animationType="fade">
        <Pressable style={styles.renameBackdrop} onPress={() => setRenameModalOpen(false)}>
          <Pressable style={[styles.renameBox, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.renameTitle, { color: colors.text }]}>{t("chat.renameTitle")}</Text>
            <TextInput
              style={[styles.renameInput, { backgroundColor: colors.surface, borderColor: colors.glassBorder, color: colors.text }]}
              placeholder={t("chat.renamePlaceholder")}
              placeholderTextColor={colors.textMuted}
              value={renameTitle}
              onChangeText={setRenameTitle}
              autoFocus
            />
            <View style={styles.renameActions}>
              <TouchableOpacity style={styles.renameCancel} onPress={() => setRenameModalOpen(false)}>
                <Text style={[styles.renameCancelText, { color: colors.text }]}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameSave, { backgroundColor: colors.primary }]} onPress={onRenameSubmit}>
                <Text style={styles.renameSaveText}>{t("common.save")}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {Platform.OS === "web" && threadMenuThread ? (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.renameBackdrop} onPress={() => setThreadMenuThread(null)}>
            <Pressable style={[styles.renameBox, styles.threadMenuBox, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]} onPress={(e) => e.stopPropagation()}>
              <Text style={[styles.renameTitle, { color: colors.text }]}>{threadMenuThread.title}</Text>
              <View style={styles.threadMenuActions}>
                <TouchableOpacity style={styles.renameCancel} onPress={() => setThreadMenuThread(null)}>
                  <Text style={[styles.renameCancelText, { color: colors.text }]}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.threadMenuBtn}
                  onPress={() => {
                    setRenameThreadId(threadMenuThread.id);
                    setRenameTitle(threadMenuThread.title);
                    setRenameModalOpen(true);
                    setThreadMenuThread(null);
                  }}
                >
                  <Text style={[styles.threadMenuBtnText, { color: colors.text }]}>{t("common.rename")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.threadMenuBtnDestructive}
                  onPress={() => {
                    onDeleteThread(threadMenuThread.id, threadMenuThread.title);
                    setThreadMenuThread(null);
                  }}
                >
                  <Text style={styles.threadMenuBtnDestructiveText}>{t("common.delete")}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      <PremiumGateModal
        visible={premiumGateVisible}
        onClose={() => setPremiumGateVisible(false)}
        onUpgrade={() => { setPremiumGateVisible(false); onOpenPricing?.(); }}
        limitReached
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#334155" },
  title: { fontSize: 20, fontWeight: "700", color: "#eee" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  headerBtnText: { fontSize: 14, color: "#94a3b8" },
  close: { fontSize: 16, color: "#38bdf8" },
  tabsScroll: { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: "#334155" },
  tabsContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: "row", alignItems: "center" },
  tabWrap: { marginRight: 8 },
  tab: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  tabActive: { backgroundColor: "#38bdf8" },
  tabText: { fontSize: 14, color: "#94a3b8", maxWidth: 120 },
  tabTextActive: { color: "#0f172a", fontWeight: "600" },
  tabMenuBtn: { marginLeft: 4, padding: 2 },
  renameBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  renameBox: { width: "100%", maxWidth: 340, borderRadius: 24, borderWidth: 1, padding: 20 },
  renameTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  renameInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, marginBottom: 16 },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  renameCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  renameCancelText: { fontSize: 16 },
  renameSave: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  renameSaveText: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  threadMenuBox: {},
  threadMenuActions: { flexDirection: "column", gap: 8, marginTop: 8 },
  threadMenuBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: "center" },
  threadMenuBtnText: { fontSize: 16 },
  threadMenuBtnDestructive: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", backgroundColor: "rgba(239, 68, 68, 0.2)" },
  threadMenuBtnDestructiveText: { fontSize: 16, color: "#ef4444", fontWeight: "600" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContent: { padding: 16, paddingBottom: 24 },
  bubble: { maxWidth: "85%", padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#38bdf8" },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 24 },
  loadingBubble: { flexDirection: "row", alignItems: "center", gap: 10 },
  loadingBubbleSpinner: { marginRight: 0 },
  bubbleText: { fontSize: 15, color: "#e2e8f0" },
  bubbleTime: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
  emptyWrap: { paddingHorizontal: 16 },
  placeholder: { color: "#94a3b8", textAlign: "center", marginTop: 24 },
  quickPrompts: { marginTop: 16 },
  quickPromptsContent: { gap: 8, paddingBottom: 8, paddingHorizontal: 16 },
  quickPromptChip: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, marginRight: 8 },
  quickPromptText: { fontSize: 14, color: "#e2e8f0" },
  attachedRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.05)" },
  attachedText: { fontSize: 14, color: "#94a3b8" },
  attachedRemove: { paddingVertical: 4, paddingHorizontal: 8 },
  attachedRemoveText: { fontSize: 14, color: "#38bdf8" },
  saveWorkoutChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  saveWorkoutChipActive: { backgroundColor: "#38bdf8" },
  saveWorkoutChipText: { fontSize: 13, color: "#e2e8f0" },
  inputRow: { flexDirection: "row", padding: 12, gap: 8, alignItems: "flex-end", borderTopWidth: 1, borderTopColor: "#334155", paddingHorizontal: 16 },
  attachBtn: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", justifyContent: "center" },
  attachBtnText: { fontSize: 14, color: "#38bdf8", fontWeight: "600" },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: "#e2e8f0", maxHeight: 100 },
  sendBtn: { backgroundColor: "#38bdf8", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: "#0f172a", fontWeight: "600" },
  orchBtn: { padding: 12, alignItems: "center", paddingHorizontal: 16 },
  orchBtnText: { fontSize: 14, color: "#b8c5d6" },
});
