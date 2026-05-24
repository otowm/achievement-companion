const NS = "ra-achievements"
const K_USERNAME = `${NS}.ra_username`
const K_API_KEY = `${NS}.ra_api_key`
const K_MAPPINGS = `${NS}.game_mappings`
const K_LOCAL_STEAM_MAPPINGS = `${NS}.local_steam_mappings`
const K_STEAM_API_KEY = `${NS}.steam_api_key`
const K_LOCAL_DETECTION_ENABLED = `${NS}.local_detection_enabled`
const K_DISMISSED = `${NS}.dismissed`
const K_LANGUAGE = `${NS}.language`

export type AppLanguage = "auto" | "pt-BR" | "en"

export interface Credentials {
  username: string
  apiKey: string
}

export interface DismissedGame {
  appId: string
  name: string
}

export function getCredentials(): Credentials | null {
  const u = localStorage.getItem(K_USERNAME) ?? ""
  const k = localStorage.getItem(K_API_KEY) ?? ""
  if (!u || !k) return null
  return { username: u, apiKey: k }
}

export function saveCredentials(username: string, apiKey: string): void {
  localStorage.setItem(K_USERNAME, username)
  localStorage.setItem(K_API_KEY, apiKey)
}

export function hasApiKey(): boolean {
  return !!localStorage.getItem(K_API_KEY)
}

export function getUsername(): string {
  return localStorage.getItem(K_USERNAME) ?? ""
}

export function getMappings(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(K_MAPPINGS) ?? "{}")
  } catch {
    return {}
  }
}

export function getMapping(steamAppId: string): number | null {
  return getMappings()[steamAppId] ?? null
}

export function setMapping(steamAppId: string, raGameId: number): void {
  const m = getMappings()
  m[steamAppId] = raGameId
  localStorage.setItem(K_MAPPINGS, JSON.stringify(m))
}

export function removeMapping(steamAppId: string): void {
  const m = getMappings()
  delete m[steamAppId]
  localStorage.setItem(K_MAPPINGS, JSON.stringify(m))
}

export function getLocalSteamAppMappings(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(K_LOCAL_STEAM_MAPPINGS) ?? "{}")
  } catch {
    return {}
  }
}

export function getLocalSteamAppMapping(shortcutAppId: string): number | null {
  return getLocalSteamAppMappings()[shortcutAppId] ?? null
}

export function setLocalSteamAppMapping(shortcutAppId: string, realSteamAppId: number): void {
  const m = getLocalSteamAppMappings()
  m[shortcutAppId] = realSteamAppId
  localStorage.setItem(K_LOCAL_STEAM_MAPPINGS, JSON.stringify(m))
}

export function removeLocalSteamAppMapping(shortcutAppId: string): void {
  const m = getLocalSteamAppMappings()
  delete m[shortcutAppId]
  localStorage.setItem(K_LOCAL_STEAM_MAPPINGS, JSON.stringify(m))
}

// Steam Web API Key — used to fetch the achievement schema (names, icons,
// descriptions) for cracked games where the emulator (Goldberg) records the
// unlocked state locally but no schema is bundled.
export function getSteamApiKey(): string {
  return localStorage.getItem(K_STEAM_API_KEY) ?? ""
}

export function saveSteamApiKey(key: string): void {
  const trimmed = key.trim()
  if (trimmed) localStorage.setItem(K_STEAM_API_KEY, trimmed)
  else localStorage.removeItem(K_STEAM_API_KEY)
}

export function isLocalDetectionEnabled(): boolean {
  return localStorage.getItem(K_LOCAL_DETECTION_ENABLED) === "1"
}

export function setLocalDetectionEnabled(enabled: boolean): void {
  if (enabled) localStorage.setItem(K_LOCAL_DETECTION_ENABLED, "1")
  else localStorage.removeItem(K_LOCAL_DETECTION_ENABLED)
}

export function getLanguagePreference(): AppLanguage {
  const value = localStorage.getItem(K_LANGUAGE)
  return value === "pt-BR" || value === "en" ? value : "auto"
}

export function setLanguagePreference(language: AppLanguage): void {
  if (language === "auto") localStorage.removeItem(K_LANGUAGE)
  else localStorage.setItem(K_LANGUAGE, language)
}

// Set of shortcut appIds the user has dismissed ("not a game I want tracked").
// Such games skip the panel entirely on subsequent visits.
function readDismissedGames(): DismissedGame[] {
  try {
    const v = JSON.parse(localStorage.getItem(K_DISMISSED) ?? "[]")
    if (!Array.isArray(v)) return []
    return v
      .map((entry) => {
        if (typeof entry === "string" || typeof entry === "number") {
          return { appId: String(entry), name: "" }
        }
        if (entry && typeof entry === "object") {
          const raw = entry as { appId?: unknown; id?: unknown; name?: unknown }
          const appId = String(raw.appId ?? raw.id ?? "")
          if (!appId) return null
          return { appId, name: typeof raw.name === "string" ? raw.name : "" }
        }
        return null
      })
      .filter((entry): entry is DismissedGame => entry != null)
  } catch {
    return []
  }
}

export function getDismissed(): string[] {
  return readDismissedGames().map((entry) => entry.appId)
}

export function getDismissedGames(): DismissedGame[] {
  return readDismissedGames()
}

export function isDismissed(appId: string): boolean {
  return readDismissedGames().some((entry) => entry.appId === appId)
}

export function addDismissed(appId: string, name = ""): void {
  const list = readDismissedGames()
  if (!list.some((entry) => entry.appId === appId)) {
    list.push({ appId, name })
    localStorage.setItem(K_DISMISSED, JSON.stringify(list))
  }
}

export function removeDismissed(appId: string): void {
  const list = readDismissedGames().filter((entry) => entry.appId !== appId)
  localStorage.setItem(K_DISMISSED, JSON.stringify(list))
}

export function clearDismissed(): void {
  localStorage.removeItem(K_DISMISSED)
}
