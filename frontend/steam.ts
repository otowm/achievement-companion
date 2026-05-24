// Reads game info from Steam's *client* store (not the Steam store HTTP API).
//
// This is the only way to get the name of a non-Steam shortcut: such games
// have no entry on store.steampowered.com, so appdetails returns success=false.
// appStore.GetAppOverviewByAppID() returns the user-defined shortcut name.

import { dbg } from "./log"

// app_type bit for non-Steam shortcuts in Steam's client.
const SHORTCUT_APP_TYPE = 1073741824

interface AppOverview {
  display_name?: string
  app_type?: number
}

interface AppStore {
  GetAppOverviewByAppID?: (appId: number) => AppOverview | null
}

export interface SteamAppInfo {
  name: string
  /** true = non-Steam shortcut (a retro game added to the library). */
  isShortcut: boolean
}

export function getSteamAppInfo(appId: string): SteamAppInfo | null {
  try {
    const store = (window as { appStore?: AppStore }).appStore
    if (!store?.GetAppOverviewByAppID) {
      dbg("appStore.GetAppOverviewByAppID unavailable")
      return null
    }
    const overview = store.GetAppOverviewByAppID(parseInt(appId, 10))
    if (!overview) {
      dbg(`no AppOverview for appId=${appId}`)
      return null
    }
    return {
      name: overview.display_name ?? "",
      isShortcut: overview.app_type === SHORTCUT_APP_TYPE,
    }
  } catch (e) {
    dbg(`getSteamAppInfo error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
