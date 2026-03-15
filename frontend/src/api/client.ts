import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from "../storage/authStorage";
import { devLog } from "../utils/devLog";
import { getApiLocale } from "./locale";

// When EXPO_PUBLIC_API_URL is explicitly "" (Docker build), use same origin so nginx can proxy /api
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL === "" ? "" : (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000");

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export { getApiLocale } from "./locale";

function languageHeader(): Record<string, string> {
  return { "X-App-Language": getApiLocale() };
}

type OfflineMutation = {
  path: string;
  method: string;
  body?: unknown;
  created_at: string;
};

const OFFLINE_QUEUE_KEY = "@tsspro_ai/offline_mutations";

async function enqueueOfflineMutation(path: string, method: string, body?: unknown): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OfflineMutation[]) : [];
    parsed.push({ path, method, body, created_at: new Date().toISOString() });
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(parsed.slice(-100)));
  } catch {
    // ignore queue persistence errors
  }
}

export async function flushOfflineMutations(): Promise<number> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return 0;
  const queue = JSON.parse(raw) as OfflineMutation[];
  if (!queue.length) return 0;

  const remaining: OfflineMutation[] = [];
  let flushed = 0;
  for (const item of queue) {
    try {
      await api(item.path, { method: item.method, body: item.body });
      flushed += 1;
    } catch {
      remaining.push(item);
      // stop at first failure to preserve order
      break;
    }
  }
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  return flushed;
}

async function doRefreshToken(): Promise<boolean> {
  const refresh = await getRefreshToken();
  if (!refresh) return false;
  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (res.status !== 200) return false;
  const data = (await res.json()) as { access_token: string; refresh_token: string };
  await setAccessToken(data.access_token);
  await setRefreshToken(data.refresh_token);
  return true;
}

export async function api<T>(
  path: string,
  options: RequestInit & { body?: unknown } = {},
  retriedAfterRefresh = false
): Promise<T> {
  const { body, ...rest } = options;
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...languageHeader(),
    ...(rest.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
  } catch (e) {
    const method = String(rest.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      Sentry.addBreadcrumb({
        message: `api ${method} ${path}: network error`,
        category: "api",
        level: "error",
      });
      await enqueueOfflineMutation(path, method, body);
      throw new Error("No network. Action queued and will retry when online.");
    }
    throw e;
  }

  try {
    if (res.status === 401) {
      if (!retriedAfterRefresh && (await doRefreshToken())) {
        return api<T>(path, options, true);
      }
      await clearAuth();
      onUnauthorized?.();
      const err = await res.text();
      throw new Error(err || "Unauthorized");
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `HTTP ${res.status}`);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  } catch (e) {
    const method = String(rest.method || "GET").toUpperCase();
    const isNetworkLike =
      e instanceof TypeError && (e.message === "Failed to fetch" || e.message?.includes("network"));
    const isNetworkError = (e as Error)?.name === "NetworkError" || (e as Error)?.message?.includes("network");
    if ((isNetworkLike || isNetworkError) && method !== "GET" && method !== "HEAD") {
      Sentry.addBreadcrumb({
        message: `api ${method} ${path}: network error`,
        category: "api",
        level: "error",
      });
      await enqueueOfflineMutation(path, method, body);
      throw new Error("No network. Action queued and will retry when online.");
    }
    throw e;
  }
}

function isWeb(): boolean {
  return Platform.OS === "web";
}

/** On native, gallery can return ph:// or content:// URIs that FormData { uri } doesn't handle. Convert to Blob via XHR. */
function uriToBlobNative(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.response instanceof Blob) resolve(xhr.response);
      else reject(new Error("Expected blob response"));
    };
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}

export async function uploadPhoto(file: { uri: string; name?: string; type?: string }, mealType?: string): Promise<NutritionResult> {
  devLog(`uploadPhoto: start uri=${file.uri?.slice(0, 60)}… platform=${Platform.OS}`);
  const form = new FormData();
  if (isWeb()) {
    devLog("uploadPhoto: web path, fetching blob from uri");
    try {
      const blob = await fetch(file.uri).then((r) => r.blob());
      devLog(`uploadPhoto: blob size=${blob.size} type=${blob.type}`);
      form.append("file", blob, file.name || "meal.jpg");
    } catch (e) {
      devLog(`uploadPhoto: blob fetch failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  } else {
    devLog("uploadPhoto: native, converting uri to blob (works for gallery ph:// and camera file://)");
    const blob = await uriToBlobNative(file.uri);
    form.append("file", blob, file.name || "photo.jpg");
  }
  if (mealType) form.append("meal_type", mealType);
  const url = `${API_BASE}/api/v1/nutrition/analyze`;
  devLog(`uploadPhoto: POST ${url}`);
  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: "application/json", ...languageHeader() };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    body: form,
    headers,
  });
  const text = await res.text();
  devLog(`uploadPhoto: response status=${res.status} body=${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`);
  if (res.status === 401) {
    if (await doRefreshToken()) {
      return uploadPhoto(file, mealType);
    }
    await clearAuth();
    onUnauthorized?.();
    devLog(`uploadPhoto: 401 Unauthorized`, "error");
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    devLog(`uploadPhoto: error ${res.status}`, "error");
    throw new Error(text || `HTTP ${res.status}`);
  }
  try {
    const data = JSON.parse(text) as NutritionResult;
    devLog(`uploadPhoto: success name=${data.name} kcal=${data.calories}`);
    return data;
  } catch (e) {
    devLog(`uploadPhoto: JSON parse failed: ${e instanceof Error ? e.message : text}`, "error");
    throw new Error(text || "Invalid response");
  }
}

export async function uploadPhotoForAnalysis(
  file: { uri: string; name?: string; type?: string },
  mealType?: string,
  save: boolean = true
): Promise<PhotoAnalyzeResponse> {
  devLog(`uploadPhotoForAnalysis: start uri=${file.uri?.slice(0, 60)}… platform=${Platform.OS} save=${save}`);
  const form = new FormData();
  if (isWeb()) {
    try {
      const blob = await fetch(file.uri).then((r) => r.blob());
      form.append("file", blob, file.name || "photo.jpg");
    } catch (e) {
      devLog(`uploadPhotoForAnalysis: blob fetch failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      throw e;
    }
  } else {
    // Native: gallery returns ph:// or content:// URIs; convert to Blob so upload works from both camera and gallery
    devLog("uploadPhotoForAnalysis: native, converting uri to blob");
    const blob = await uriToBlobNative(file.uri);
    form.append("file", blob, file.name || "photo.jpg");
  }
  if (mealType) form.append("meal_type", mealType);
  const d = new Date();
  const todayLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  form.append("wellness_date", todayLocal);
  const query = save ? "" : "?save=false";
  const url = `${API_BASE}/api/v1/photo/analyze${query}`;
  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: "application/json", ...languageHeader() };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", body: form, headers });
  const text = await res.text();
  devLog(`uploadPhotoForAnalysis: status=${res.status} body=${text.slice(0, 150)}…`);
  if (res.status === 401) {
    if (await doRefreshToken()) {
      return uploadPhotoForAnalysis(file, mealType, save);
    }
    await clearAuth();
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  try {
    return JSON.parse(text) as PhotoAnalyzeResponse;
  } catch (e) {
    throw new Error(text || "Invalid response");
  }
}

export interface NutritionResult {
  id?: number;
  name: string;
  portion_grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  extended_nutrients?: Record<string, number> | null;
}

export type EditableNutritionFields = Pick<
  NutritionResult,
  "name" | "portion_grams" | "calories" | "protein_g" | "fat_g" | "carbs_g"
>;

export interface SleepPhaseSegment {
  start: string;
  end: string;
  phase: string;
}

export interface SleepExtractedData {
  date?: string | null;
  sleep_hours?: number | null;
  sleep_minutes?: number | null;
  actual_sleep_hours?: number | null;
  actual_sleep_minutes?: number | null;
  time_in_bed_min?: number | null;
  quality_score?: number | null;
  score_delta?: number | null;
  efficiency_pct?: number | null;
  rest_min?: number | null;
  deep_sleep_min?: number | null;
  rem_min?: number | null;
  light_sleep_min?: number | null;
  awake_min?: number | null;
  factor_ratings?: Record<string, string> | null;
  sleep_phases?: SleepPhaseSegment[] | null;
  sleep_periods?: string[] | null;
  latency_min?: number | null;
  awakenings?: number | null;
  bedtime?: string | null;
  wake_time?: string | null;
  source_app?: string | null;
  raw_notes?: string | null;
}

export interface SleepExtractionResponse {
  id: number;
  extracted_data: SleepExtractedData;
  created_at: string;
}

export interface WellnessPhotoResult {
  rhr?: number | null;
  hrv?: number | null;
}

export interface WorkoutPhotoResult {
  name?: string | null;
  date?: string | null;
  sport_type?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  calories?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  tss?: number | null;
  notes?: string | null;
}

export type PhotoAnalyzeResponse =
  | { type: "food"; food: NutritionResult }
  | { type: "sleep"; sleep: SleepExtractionResponse }
  | { type: "wellness"; wellness: WellnessPhotoResult }
  | { type: "workout"; workout: WorkoutPhotoResult };

export interface NutritionDayEntry {
  id: number;
  name: string;
  portion_grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  meal_type: string;
  timestamp: string;
  extended_nutrients?: Record<string, number> | null;
  can_reanalyze?: boolean;
}

export interface NutritionDayTotals {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface NutritionDayResponse {
  date: string;
  entries: NutritionDayEntry[];
  totals: NutritionDayTotals;
}

export interface WellnessDay {
  date: string;
  sleep_hours?: number;
  rhr?: number;
  hrv?: number;
  ctl?: number;
  atl?: number;
  tsb?: number;
  weight_kg?: number;
  sport_info?: Array<{ type?: string; eftp?: number; wPrime?: number; pMax?: number }>;
}

export interface EventItem {
  id: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  type?: string;
}

export interface ActivityItem {
  id: string;
  name?: string;
  start_date?: string;
  duration_sec?: number;
  distance_km?: number;
  tss?: number;
  type?: string;
}

export interface WorkoutItem {
  id: number;
  start_date: string;
  name?: string | null;
  type?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  tss?: number | null;
  source: string;
  notes?: string | null;
  raw?: Record<string, unknown> | null;
  fit_checksum?: string | null;
}

/** Response from POST /workouts/preview-fit (no id, no source). */
export interface WorkoutPreviewItem {
  start_date: string;
  name?: string | null;
  type?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  tss?: number | null;
  raw?: Record<string, unknown> | null;
}

export interface WorkoutFitness {
  ctl: number;
  atl: number;
  tsb: number;
  date: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export async function getWorkouts(
  fromDate?: string,
  toDate?: string,
  limit = 50,
  offset = 0
): Promise<PaginatedResponse<WorkoutItem>> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return api<PaginatedResponse<WorkoutItem>>(`/api/v1/workouts?${params}`);
}

export async function getWorkoutFitness(date?: string): Promise<WorkoutFitness | null> {
  const path = date ? `/api/v1/workouts/fitness?date=${encodeURIComponent(date)}` : "/api/v1/workouts/fitness";
  return api<WorkoutFitness | null>(path);
}

export type WorkoutCreatePayload = {
  start_date: string;
  name?: string | null;
  type?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  tss?: number | null;
  notes?: string | null;
};

export async function createWorkout(payload: WorkoutCreatePayload): Promise<WorkoutItem> {
  return api<WorkoutItem>("/api/v1/workouts", { method: "POST", body: payload });
}

export async function updateWorkout(
  workoutId: number,
  payload: Partial<WorkoutCreatePayload>
): Promise<WorkoutItem> {
  return api<WorkoutItem>(`/api/v1/workouts/${workoutId}`, { method: "PATCH", body: payload });
}

export async function deleteWorkout(workoutId: number): Promise<void> {
  return api<void>(`/api/v1/workouts/${workoutId}`, { method: "DELETE" });
}

export async function previewFitWorkout(file: Blob | { uri: string; name: string }): Promise<WorkoutPreviewItem> {
  const API_BASE =
    process.env.EXPO_PUBLIC_API_URL === "" ? "" : (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000");
  const token = await getAccessToken();
  const form = new FormData();
  if (file instanceof Blob) {
    form.append("file", file, "workout.fit");
  } else {
    const blob = await fetch(file.uri).then((r) => r.blob());
    form.append("file", blob, file.name || "workout.fit");
  }
  const res = await fetch(`${API_BASE}/api/v1/workouts/preview-fit`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (res.status === 401) {
    if (await doRefreshToken()) {
      return previewFitWorkout(file);
    }
    await clearAuth();
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Preview failed: ${res.status}`);
  }
  return res.json() as Promise<WorkoutPreviewItem>;
}

export async function uploadFitWorkout(file: Blob | { uri: string; name: string }): Promise<WorkoutItem> {
  const API_BASE =
    process.env.EXPO_PUBLIC_API_URL === "" ? "" : (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000");
  const token = await getAccessToken();
  const form = new FormData();
  if (file instanceof Blob) {
    form.append("file", file, "workout.fit");
  } else {
    const blob = await fetch(file.uri).then((r) => r.blob());
    form.append("file", blob, file.name || "workout.fit");
  }
  const res = await fetch(`${API_BASE}/api/v1/workouts/upload-fit`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (res.status === 401) {
    if (await doRefreshToken()) {
      return uploadFitWorkout(file);
    }
    await clearAuth();
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (res.status === 409) {
    const t = await res.text();
    throw new Error(t || "This FIT file was already imported.");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Upload failed: ${res.status}`);
  }
  return res.json() as Promise<WorkoutItem>;
}

export interface ChatMessage {
  role: string;
  content: string;
  timestamp?: string;
}

export async function getNutritionDay(dateStr: string): Promise<NutritionDayResponse> {
  const params = new URLSearchParams({ date: dateStr });
  return api<NutritionDayResponse>(`/api/v1/nutrition/day?${params}`);
}

export type NutritionEntryUpdatePayload = {
  name?: string;
  portion_grams?: number;
  calories?: number;
  protein_g?: number;
  fat_g?: number;
  carbs_g?: number;
  meal_type?: string;
};

export async function updateNutritionEntry(
  entryId: number,
  payload: NutritionEntryUpdatePayload
): Promise<NutritionDayEntry> {
  return api<NutritionDayEntry>(`/api/v1/nutrition/entries/${entryId}`, {
    method: "PATCH",
    body: payload,
  });
}

export async function deleteNutritionEntry(entryId: number): Promise<{ status: string }> {
  return api<{ status: string }>(`/api/v1/nutrition/entries/${entryId}`, { method: "DELETE" });
}

export async function reanalyzeNutritionEntry(
  entryId: number,
  payload: { name?: string; portion_grams?: number; correction?: string }
): Promise<NutritionDayEntry> {
  return api<NutritionDayEntry>(`/api/v1/nutrition/entries/${entryId}/reanalyze`, {
    method: "POST",
    body: payload,
  });
}

export async function analyzeNutritionFromText(payload: {
  name: string;
  portion_grams?: number;
  correction?: string;
}): Promise<NutritionResult> {
  return api<NutritionResult>("/api/v1/nutrition/analyze-from-text", {
    method: "POST",
    body: payload,
  });
}

export type CreateNutritionEntryPayload = {
  name: string;
  portion_grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  meal_type?: string;
  date?: string;
};

export async function createNutritionEntry(payload: CreateNutritionEntryPayload): Promise<NutritionDayEntry> {
  return api<NutritionDayEntry>("/api/v1/nutrition/entries", {
    method: "POST",
    body: payload,
  });
}

export type AddFoodFromTextPayload = {
  name: string;
  portion_grams: number;
  meal_type?: string;
  date?: string;
};

export async function addFoodFromText(payload: AddFoodFromTextPayload): Promise<NutritionDayEntry> {
  return api<NutritionDayEntry>("/api/v1/nutrition/entries/add-from-text", {
    method: "POST",
    body: payload,
  });
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && (e.message === "Failed to fetch" || e.message?.includes("network"))) return true;
  const err = e as Error;
  return err?.name === "NetworkError" || (typeof err?.message === "string" && err.message.includes("network"));
}

export async function saveSleepFromPreview(extracted_data: SleepExtractedData): Promise<SleepExtractionResponse> {
  try {
    return await api<SleepExtractionResponse>("/api/v1/photo/save-sleep", {
      method: "POST",
      body: extracted_data,
    });
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return api<SleepExtractionResponse>("/api/v1/photo/save-sleep", {
      method: "POST",
      body: extracted_data,
    });
  }
}

export async function getWellness(
  fromDate?: string,
  toDate?: string,
  limit = 50,
  offset = 0
): Promise<PaginatedResponse<WellnessDay>> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return api<PaginatedResponse<WellnessDay>>(`/api/v1/wellness?${params}`);
}

export type WellnessUpsertPayload = {
  date: string;
  sleep_hours?: number;
  rhr?: number;
  hrv?: number;
  weight_kg?: number;
};

export async function createOrUpdateWellness(payload: WellnessUpsertPayload): Promise<WellnessDay> {
  return api<WellnessDay>("/api/v1/wellness", { method: "PUT", body: payload });
}

export async function deleteWellness(date: string): Promise<void> {
  await api<void>(`/api/v1/wellness/${date}`, { method: "DELETE" });
}

export interface SleepExtractionSummary {
  id: number;
  created_at: string;
  sleep_date?: string | null;
  sleep_hours?: number | null;
  actual_sleep_hours?: number | null;
  quality_score?: number | null;
  can_reanalyze?: boolean;
}

export async function getSleepExtractions(fromDate?: string, toDate?: string): Promise<SleepExtractionSummary[]> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  return api<SleepExtractionSummary[]>(`/api/v1/photo/sleep-extractions?${params}`);
}

export async function reanalyzeSleepExtraction(
  extractionId: number,
  correction: string
): Promise<SleepExtractionResponse> {
  return api<SleepExtractionResponse>(`/api/v1/photo/sleep-extractions/${extractionId}/reanalyze`, {
    method: "POST",
    body: { correction },
  });
}

export async function deleteSleepExtraction(extractionId: number): Promise<void> {
  return api<void>(`/api/v1/photo/sleep-extractions/${extractionId}`, { method: "DELETE" });
}

export async function getEvents(fromDate?: string, toDate?: string): Promise<EventItem[]> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  return api<EventItem[]>(`/api/v1/intervals/events?${params}`);
}

export async function getActivities(fromDate?: string, toDate?: string): Promise<ActivityItem[]> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  return api<ActivityItem[]>(`/api/v1/intervals/activities?${params}`);
}

export async function getIntervalsStatus(): Promise<{ linked: boolean; athlete_id?: string }> {
  return api<{ linked: boolean; athlete_id?: string }>("/api/v1/intervals/status");
}

export async function getIntervalsOAuthRedirectUrl(returnApp?: boolean): Promise<{ redirect_url: string }> {
  const params = returnApp ? "?return_app=1" : "";
  return api<{ redirect_url: string }>(`/api/v1/intervals/oauth/authorize${params}`);
}

export async function linkIntervals(athleteId: string, apiKey: string): Promise<{ status: string; athlete_id: string }> {
  return api<{ status: string; athlete_id: string }>("/api/v1/intervals/link", {
    method: "POST",
    body: { athlete_id: athleteId, api_key: apiKey },
  });
}

export async function unlinkIntervals(): Promise<{ status: string }> {
  return api<{ status: string }>("/api/v1/intervals/unlink", { method: "POST" });
}

export interface SyncIntervalsResponse {
  status: string;
  user_id?: number;
  activities_synced?: number;
  wellness_days_synced?: number;
}

export async function syncIntervals(clientToday?: string): Promise<SyncIntervalsResponse> {
  const body = clientToday ? { client_today: clientToday } : {};
  return api<SyncIntervalsResponse>("/api/v1/intervals/sync", { method: "POST", body });
}

export interface NutritionGoals {
  calorie_goal?: number;
  protein_goal?: number;
  fat_goal?: number;
  carbs_goal?: number;
}

export interface AthleteProfileResponse {
  weight_kg: number | null;
  weight_source: string | null;
  ftp: number | null;
  ftp_source: string | null;
  height_cm: number | null;
  birth_year: number | null;
  display_name: string;
  nutrition_goals?: NutritionGoals | null;
  target_race_date?: string | null;
  target_race_name?: string | null;
  days_to_race?: number | null;
  is_premium?: boolean;
  dev_can_toggle_premium?: boolean;
  locale?: string;
}

export async function getAthleteProfile(): Promise<AthleteProfileResponse> {
  return api<AthleteProfileResponse>("/api/v1/athlete-profile");
}

export async function updateAthleteProfile(body: {
  weight_kg?: number | null;
  height_cm?: number | null;
  birth_year?: number | null;
  ftp?: number | null;
  calorie_goal?: number | null;
  protein_goal?: number | null;
  fat_goal?: number | null;
  carbs_goal?: number | null;
  target_race_date?: string | null;
  target_race_name?: string | null;
  locale?: string | null;
}): Promise<AthleteProfileResponse> {
  return api<AthleteProfileResponse>("/api/v1/athlete-profile", {
    method: "PATCH",
    body,
  });
}

export async function updateMyPremium(is_premium: boolean): Promise<{ is_premium: boolean }> {
  return api<{ is_premium: boolean }>("/api/v1/users/me/premium", {
    method: "PATCH",
    body: { is_premium },
  });
}

// Billing (Stripe)
export type BillingPlan = "monthly" | "annual";

export interface SubscriptionStatus {
  has_subscription: boolean;
  is_premium: boolean;
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean | null;
}

export async function createCheckoutSession(
  plan: BillingPlan,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string }> {
  return api<{ url: string }>("/api/v1/billing/checkout-session", {
    method: "POST",
    body: { plan, success_url: successUrl, cancel_url: cancelUrl },
  });
}

export async function createPortalSession(returnUrl: string): Promise<{ url: string }> {
  return api<{ url: string }>("/api/v1/billing/portal-session", {
    method: "POST",
    body: { return_url: returnUrl },
  });
}

export async function getSubscription(): Promise<SubscriptionStatus> {
  return api<SubscriptionStatus>("/api/v1/billing/subscription");
}

/** Billing status with plan, subscription state, and daily usage limits. */
export interface BillingStatus {
  plan: "Free" | "Premium";
  subscription_status: string | null;
  current_period_end: string | null;
  photo_analyses_used: number;
  photo_analyses_limit: number | null;
  chat_messages_used: number;
  chat_messages_limit: number | null;
}

export async function getBillingStatus(): Promise<BillingStatus> {
  return api<BillingStatus>("/api/v1/billing/status");
}

export interface ChatThreadItem {
  id: number;
  title: string;
  created_at: string | null;
}

export async function getChatThreads(limit = 50, offset = 0): Promise<PaginatedResponse<ChatThreadItem>> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return api<PaginatedResponse<ChatThreadItem>>(`/api/v1/chat/threads?${params}`);
}

export async function createChatThread(title?: string): Promise<ChatThreadItem> {
  return api<ChatThreadItem>("/api/v1/chat/threads", {
    method: "POST",
    body: title ? { title } : {},
  });
}

export async function updateChatThread(threadId: number, body: { title: string }): Promise<ChatThreadItem> {
  return api<ChatThreadItem>(`/api/v1/chat/threads/${threadId}`, { method: "PATCH", body });
}

export async function deleteChatThread(threadId: number): Promise<void> {
  return api<void>(`/api/v1/chat/threads/${threadId}`, { method: "DELETE" });
}

export async function clearChatThread(threadId: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/v1/chat/threads/${threadId}/clear`, { method: "POST" });
}

export async function getChatHistory(threadId: number | null, limit = 50): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (threadId != null) params.set("thread_id", String(threadId));
  return api<ChatMessage[]>(`/api/v1/chat/history?${params}`);
}

export async function sendChatMessage(
  message: string,
  runOrchestrator = false,
  threadId?: number | null
): Promise<{ reply: string }> {
  return api<{ reply: string }>("/api/v1/chat/send", {
    method: "POST",
    body: {
      message,
      run_orchestrator: runOrchestrator,
      thread_id: threadId ?? undefined,
      client_now: new Date().toISOString(),
    },
  });
}

/** Send a message with an attached FIT file (multipart). Optionally save the workout to the diary. */
export async function sendChatMessageWithFit(
  message: string,
  file: Blob | { uri: string; name: string },
  threadId?: number | null,
  saveWorkout = false
): Promise<{ reply: string }> {
  const API_BASE =
    process.env.EXPO_PUBLIC_API_URL === "" ? "" : (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000");
  const token = await getAccessToken();
  const form = new FormData();
  form.append("message", message);
  form.append("run_orchestrator", "false");
  if (threadId != null) form.append("thread_id", String(threadId));
  form.append("save_workout", saveWorkout ? "true" : "false");
  form.append("client_now", new Date().toISOString());
  if (file instanceof Blob) {
    form.append("file", file, "workout.fit");
  } else {
    const blob = await fetch(file.uri).then((r) => r.blob());
    form.append("file", blob, file.name || "workout.fit");
  }
  const res = await fetch(`${API_BASE}/api/v1/chat/send-with-file`, {
    method: "POST",
    headers: { ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (res.status === 401) {
    if (await doRefreshToken()) {
      return sendChatMessageWithFit(message, file, threadId, saveWorkout);
    }
    await clearAuth();
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (res.status === 403) {
    const t = await res.text();
    throw new Error(t || "Premium required");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Upload failed: ${res.status}`);
  }
  return res.json() as Promise<{ reply: string }>;
}

/** Send a message with an attached image (multipart). Premium only. */
export async function sendChatMessageWithImage(
  message: string,
  imageFile: Blob | { uri: string; name: string },
  threadId?: number | null
): Promise<{ reply: string }> {
  const API_BASE =
    process.env.EXPO_PUBLIC_API_URL === "" ? "" : (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000");
  const token = await getAccessToken();
  const form = new FormData();
  form.append("message", message);
  if (threadId != null) form.append("thread_id", String(threadId));
  form.append("client_now", new Date().toISOString());
  if (imageFile instanceof Blob) {
    const ext = (imageFile as File).name?.match(/\.[a-z]+$/i)?.[0] || ".jpg";
    form.append("file", imageFile, `photo${ext}`);
  } else {
    const blob = await fetch(imageFile.uri).then((r) => r.blob());
    const name = imageFile.name || "photo.jpg";
    form.append("file", blob, name);
  }
  const res = await fetch(`${API_BASE}/api/v1/chat/send-with-image`, {
    method: "POST",
    headers: { ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (res.status === 401) {
    if (await doRefreshToken()) {
      return sendChatMessageWithImage(message, imageFile, threadId);
    }
    await clearAuth();
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (res.status === 403) {
    const t = await res.text();
    throw new Error(t || "Premium required");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Upload failed: ${res.status}`);
  }
  return res.json() as Promise<{ reply: string }>;
}

export async function runOrchestrator(
  locale?: string,
  clientLocalHour?: number
): Promise<{
  decision: string;
  reason?: string;
  modified_plan?: unknown;
  suggestions_next_days?: string;
  evening_tips?: string;
  plan_tomorrow?: string;
  is_teaser?: boolean;
}> {
  const hour =
    clientLocalHour !== undefined && clientLocalHour !== null
      ? clientLocalHour
      : new Date().getHours();
  return api("/api/v1/chat/orchestrator/run", {
    method: "POST",
    body: { locale: locale ?? "en", client_local_hour: hour },
  });
}

// Analytics
export interface AnalyticsOverview {
  from_date: string;
  to_date: string;
  avg_sleep_hours: number | null;
  wellness_days_with_sleep: number;
  ctl_atl_tsb: { ctl: number; atl: number; tsb: number } | null;
  workout_count: number;
  total_tss: number;
  days_with_food: number;
  avg_calories_per_day: number | null;
  goals: { calorie_goal?: number; protein_goal?: number };
}

export interface AnalyticsSleepItem {
  date: string;
  sleep_hours: number | null;
  rhr: number | null;
  hrv: number | null;
}

export interface AnalyticsSleepResponse {
  from_date: string;
  to_date: string;
  items: AnalyticsSleepItem[];
}

export interface AnalyticsWorkoutsResponse {
  from_date: string;
  to_date: string;
  workouts: Array<{
    date: string | null;
    name: string | null;
    type: string | null;
    duration_sec: number | null;
    distance_m: number | null;
    tss: number | null;
  }>;
  daily: Array<{
    date: string;
    duration_sec: number;
    tss: number;
    distance_m: number;
  }>;
  load: Array<{
    date: string;
    ctl: number | null;
    atl: number | null;
    tsb: number | null;
  }>;
}

export interface AnalyticsNutritionItem {
  date: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  entries: number;
  extended_nutrients?: Record<string, number>;
}

export interface AnalyticsNutritionResponse {
  from_date: string;
  to_date: string;
  items: AnalyticsNutritionItem[];
  goals: {
    calorie_goal?: number;
    protein_goal?: number;
    fat_goal?: number;
    carbs_goal?: number;
  };
}

export async function getAnalyticsOverview(
  fromDate?: string,
  toDate?: string,
  days = 30
): Promise<AnalyticsOverview> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  params.set("days", String(days));
  return api<AnalyticsOverview>(`/api/v1/analytics/overview?${params}`);
}

export async function getAnalyticsSleep(
  fromDate?: string,
  toDate?: string,
  days = 30
): Promise<AnalyticsSleepResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  params.set("days", String(days));
  return api<AnalyticsSleepResponse>(`/api/v1/analytics/sleep?${params}`);
}

export async function getAnalyticsWorkouts(
  fromDate?: string,
  toDate?: string,
  days = 30
): Promise<AnalyticsWorkoutsResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  params.set("days", String(days));
  return api<AnalyticsWorkoutsResponse>(`/api/v1/analytics/workouts?${params}`);
}

export async function getAnalyticsNutrition(
  fromDate?: string,
  toDate?: string,
  days = 30
): Promise<AnalyticsNutritionResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  params.set("days", String(days));
  return api<AnalyticsNutritionResponse>(`/api/v1/analytics/nutrition?${params}`);
}

export interface AnalyticsInsightResponse {
  insight: string;
  is_teaser?: boolean;
}

export async function postAnalyticsInsight(
  chartType: string,
  data: Record<string, unknown>,
  question?: string
): Promise<AnalyticsInsightResponse> {
  return api<AnalyticsInsightResponse>("/api/v1/analytics/insight", {
    method: "POST",
    body: { chart_type: chartType, data, question: question ?? undefined },
  });
}

// Auth (no token required for login/register)
export interface AuthUser {
  id: number;
  email: string;
  is_premium?: boolean;
}
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>("/api/v1/auth/register", {
    method: "POST",
    body: { email, password },
  });
}

export async function getMe(): Promise<AuthUser> {
  return api<AuthUser>("/api/v1/auth/me");
}

export async function savePushToken(token: string, platform?: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/api/v1/users/push-token", {
    method: "POST",
    body: { token, platform },
  });
}
