import { callable } from "@steambrew/client"
import { getCredentials, getLocalSteamAppMapping, getSteamApiKey, isLocalDetectionEnabled } from "./store"

// Order of keys MUST match Lua function parameter order — Millennium's IPC
// uses nlohmann::ordered_json which preserves insertion order when unpacking
// argumentList into positional Lua args.
const validateRaw = callable<[{ username: string; api_key: string }], string>("validate_credentials")
const searchRaw = callable<[{ username: string; api_key: string; query: string }], string>("search_ra_games")
const resolveRaw = callable<[{ username: string; api_key: string; steam_app_id: string; steam_name: string }], string>("resolve_steam_game")
const achievementsRaw = callable<[{ username: string; api_key: string; ra_game_id: number }], string>("get_achievements")
const consolesRaw = callable<[{ api_key: string; username: string }], string>("get_ra_consoles")
const consoleSearchRaw =
  callable<[{ api_key: string; console_id: number; query: string; username: string }], string>("search_console_games")
const localAchievementsRaw =
  callable<[{ api_key_steam: string; app_id: string; steam_app_id: string; steam_name: string }], string>("get_local_achievements")
const exportLocalBackupRaw = callable<[Record<string, never>], string>("export_local_achievement_backup")
const importLocalBackupRaw = callable<[{ path: string }], string>("import_local_achievement_backup")

function parse<T>(s: string): T {
  return JSON.parse(s) as T
}

export interface Candidate {
  id: number
  title: string
  console: string
  icon: string
}

export interface ResolveResult {
  found: boolean
  confidence: "high" | "low" | "none"
  ra_game_id: number | null
  ra_title: string | null
  candidates: Candidate[]
  steam_name?: string | null
  error?: string | null
}

export interface Achievement {
  id: number
  title: string
  description: string
  points: number
  badge_url: string
  badge_locked_url: string
  earned: boolean
  earned_hardcore: boolean
  date_earned: string | null
  date_earned_hardcore: string | null
  display_order: number
  num_awarded: number
  num_awarded_hardcore: number
}

export interface AchievementsResponse {
  /** "ok" on success; any other value is a diagnostic from local lookup. */
  status: string
  /** Where the data came from. "ra" (RetroAchievements) or "local" (Steam emulator). */
  source?: "ra" | "local"
  /** When source = "local", which Steam emulator produced the state file. */
  emulator?: string
  /** Where the local emulator state was found, e.g. Proton prefix or Windows native. */
  emulator_source?: string
  /** True when local data was shown without Steam's achievement schema. */
  schema_missing?: boolean
  schema_error?: string
  game?: { id: number; title: string; console: string; icon_url: string }
  progress?: { earned: number; earned_hardcore: number; total: number; points: number; total_points: number }
  achievements?: Achievement[]
  error?: string
}

export interface LocalBackupResult {
  status: "ok" | "error"
  path?: string
  saves?: number
  imported?: number
  failed?: Array<{ steam_app_id?: number | string; emulator?: string; error?: string }>
  written?: Array<{ steam_app_id: number; emulator: string; path: string }>
  error?: string
}

export async function validateCredentials(username: string, api_key: string): Promise<{ success: boolean; error: string | null }> {
  return parse(await validateRaw({ username, api_key }))
}

export interface SearchResult {
  results: Candidate[]
  /** Raw RA API outcome — surfaced in the UI when a search returns nothing. */
  diag: string
}

export async function searchGames(query: string): Promise<SearchResult> {
  const c = getCredentials()
  if (!c) return { results: [], diag: "sem credenciais salvas" }
  const r = parse<{ results?: unknown; diag?: unknown }>(
    await searchRaw({ username: c.username, api_key: c.apiKey, query }),
  )
  return {
    results: Array.isArray(r.results) ? (r.results as Candidate[]) : [],
    diag: typeof r.diag === "string" ? r.diag : "",
  }
}

export interface RaConsole {
  id: number
  name: string
}

/** RetroAchievements console list (game systems only), for the search picker. */
export async function getRaConsoles(): Promise<RaConsole[]> {
  const c = getCredentials()
  if (!c) return []
  const r = parse<{ consoles?: unknown }>(
    await consolesRaw({ api_key: c.apiKey, username: c.username }),
  )
  return Array.isArray(r.consoles) ? (r.consoles as RaConsole[]) : []
}

/** Fuzzy-search games by name within a single console (the working search). */
export async function searchConsoleGames(consoleId: number, query: string): Promise<SearchResult> {
  const c = getCredentials()
  if (!c) return { results: [], diag: "sem credenciais salvas" }
  const r = parse<{ results?: unknown; diag?: unknown }>(
    await consoleSearchRaw({ api_key: c.apiKey, console_id: consoleId, query, username: c.username }),
  )
  return {
    results: Array.isArray(r.results) ? (r.results as Candidate[]) : [],
    diag: typeof r.diag === "string" ? r.diag : "",
  }
}

export async function resolveSteamGame(steam_app_id: string, steam_name: string): Promise<ResolveResult | null> {
  const c = getCredentials()
  if (!c) return null
  const r = parse<ResolveResult>(await resolveRaw({ username: c.username, api_key: c.apiKey, steam_app_id, steam_name }))
  // Backend always sends an array, but guard so a malformed payload can't
  // crash the search modal (.map on a non-array).
  if (!Array.isArray(r.candidates)) r.candidates = []
  return r
}

export async function fetchAchievements(ra_game_id: number): Promise<AchievementsResponse> {
  const c = getCredentials()
  if (!c) return { status: "error", error: "no_credentials" }
  const r = parse<AchievementsResponse>(await achievementsRaw({ username: c.username, api_key: c.apiKey, ra_game_id }))
  if (r.status === "ok") r.source = "ra"
  return r
}

/**
 * Look up local achievements for a non-Steam shortcut: the backend finds the
 * Wine prefix, reads the Steam-emulator save (Goldberg/RUNE/OnlineFix), and fetches the
 * achievement schema from Steam. Returns null when no Steam Web API key is
 * configured (the schema source).
 */
export async function getLocalAchievements(appId: string, steamName: string): Promise<AchievementsResponse | null> {
  if (!isLocalDetectionEnabled()) return null
  const key = getSteamApiKey()
  if (!key) return null
  const steamAppId = getLocalSteamAppMapping(appId)
  try {
    return parse<AchievementsResponse>(
      await localAchievementsRaw({
        api_key_steam: key,
        app_id: appId,
        steam_app_id: steamAppId ? String(steamAppId) : "",
        steam_name: steamName,
      }),
    )
  } catch {
    return null
  }
}

export async function exportLocalAchievementBackup(): Promise<LocalBackupResult> {
  return parse<LocalBackupResult>(await exportLocalBackupRaw({}))
}

export async function importLocalAchievementBackup(path: string): Promise<LocalBackupResult> {
  return parse<LocalBackupResult>(await importLocalBackupRaw({ path }))
}
