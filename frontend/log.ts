// Shared debug logger. Writes to localStorage so the log survives across
// contexts and can be inspected from the settings page (and copied out).

export const DEBUG_LOG_KEY = "ra-achievements.debug-log"
const DEBUG_LOG_MAX = 120

export function dbg(msg: string): void {
  try {
    const arr = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) ?? "[]") as string[]
    arr.push(`${new Date().toISOString().slice(11, 19)} ${msg}`)
    while (arr.length > DEBUG_LOG_MAX) arr.shift()
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(arr))
  } catch {}
  try { console.log("[RA]", msg) } catch {}
}
