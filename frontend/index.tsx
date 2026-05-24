import React from "react"
import { definePlugin, Millennium } from "@steambrew/client"
import { SettingsPage } from "./components/SettingsPage"
import { AchievementPanel, PanelProgress } from "./components/AchievementPanel"
import { ensureStyles } from "./styles/panelCss"
import { getSteamAppInfo } from "./steam"
import { isDismissed } from "./store"
import { dbg } from "./log"
import { t } from "./i18n"

const CONTAINER_ID = "ra-game-panel-root"
const ACTION_ITEM_ID = "ra-action-stat"
const RIGHT_PANEL_SELECTOR = ".WideRightPanel"
const NOTES_WAIT_BEFORE_FALLBACK_MS = 1800
const INSERTION_POINT_TIMEOUT_MS = 12000
const NAV_HEARTBEAT_MS = 5000

// Steam's CSS-module class hashes change between client updates, so the page
// selectors live here as named constants — if injection stops working,
// re-capture these and update them. Both are anchored on the readable
// `.WideRightPanel` class to keep the brittle chains shorter.

// The notes ("anotações") block in a library game page's right column. The RA
// panel is inserted as that block's previous sibling (renders above the notes).
const NOTES_SELECTOR =
  ".WideRightPanel > div._2Dd4T78PcCTUVgOtDGFY5j > div > " +
  "div._3VQUewWB8g6Z5qB4C7dGFr._2iE-78WxX2Pj4GHbq7YJiA > div > div > " +
  "div._1_cYNJSvS6IXs9vLTEYjy5.Panel > div > div.OhSdLYuggDtBcWjYP0j_9 > " +
  "div._2aor4XVOYzN1PBSREk0UbO > div:nth-child(1)"

// The stat row in the game hero (holds ESTADO DA NUVEM / TEMPO DE JOGO / …).
// The RA progress stat is appended as its last child. Targeting the row —
// rather than a specific sibling stat — keeps it working for non-Steam
// shortcuts, which have no native "CONQUISTAS" stat to anchor after.
const ACTION_ROW_SELECTOR =
  ".WideRightPanel > div._2Dd4T78PcCTUVgOtDGFY5j > div > " +
  "div._3VQUewWB8g6Z5qB4C7dGFr._2iE-78WxX2Pj4GHbq7YJiA > div > div > " +
  "div._1_cYNJSvS6IXs9vLTEYjy5.Panel > div > " +
  "div._3Yf8b2v5oOD8Wqsxu04ar._1U7LKpx70kEsz3jJwAFOi- > " +
  "div._3fLo166MlaNqP8r8tTyRz._3DeO92O5aVkcdwEBCJDjWm > div > div > " +
  "div._1YbtIWcfkQJOysLXQbwzRf > div > div._1mDAVT4sTzFRwJtlKCw2Ws"

interface SteamPopup {
  m_strName: string
  m_popup: {
    window: Window & typeof globalThis
    document: Document
  }
}

declare global {
  interface Window {
    MainWindowBrowserManager?: {
      m_browser: { on: (event: string, cb: (...args: unknown[]) => void) => void }
      m_lastLocation?: unknown
    }
  }
}

function getAppIdFromUrl(url: unknown): string | null {
  // m_lastLocation is usually an object ({pathname, href, ...}), but can be a
  // string or undefined depending on Steam state. Coerce defensively.
  let s: string
  if (typeof url === "string") {
    s = url
  } else if (url && typeof url === "object") {
    const obj = url as { pathname?: unknown; href?: unknown; url?: unknown }
    s = String(obj.pathname ?? obj.href ?? obj.url ?? "")
  } else {
    return null
  }
  if (!s) return null
  const m = s.match(/\/library\/app\/(\d+)/)
  return m?.[1] ?? null
}

interface InsertionPoint {
  parent: Element
  before: Element | null
  label: string
}

function getRightPanelContent(doc: Document): Element | null {
  const exact = doc.querySelector(".WideRightPanel > div._2Dd4T78PcCTUVgOtDGFY5j > div")
  if (exact) return exact

  const rightPanel = doc.querySelector(RIGHT_PANEL_SELECTOR)
  if (!rightPanel) return null

  const firstSteamPanel = rightPanel.querySelector(".Panel")
  if (firstSteamPanel?.parentElement) return firstSteamPanel.parentElement

  return rightPanel.childElementCount > 0 ? rightPanel : null
}

function findInsertionPoint(doc: Document, allowFallback: boolean): InsertionPoint | null {
  const notesBlock = doc.querySelector(NOTES_SELECTOR)
  if (notesBlock?.parentElement) {
    return {
      parent: notesBlock.parentElement,
      before: notesBlock,
      label: "above notes",
    }
  }

  if (!allowFallback) return null

  const content = getRightPanelContent(doc)
  if (!content) return null

  return {
    parent: content,
    before: null,
    label: "right panel fallback",
  }
}

async function waitForInsertionPoint(
  doc: Document,
  timeoutMs: number,
): Promise<InsertionPoint | null> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs

  for (;;) {
    const allowFallback = Date.now() - startedAt >= NOTES_WAIT_BEFORE_FALLBACK_MS
    const point = findInsertionPoint(doc, allowFallback)
    if (point) return point
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 120))
  }
}

// ── React mount management ─────────────────────────────────────────────

interface ReactRoot {
  render: (node: React.ReactNode) => void
  unmount: () => void
}

let panelRoot: ReactRoot | null = null
let panelContainer: HTMLElement | null = null
// Bumped on every navigation so a slow, superseded mountPanel() aborts itself.
let mountGeneration = 0

/** Tear down the React root, detach the container, drop the action-bar stat. */
function disposeRoot() {
  const doc = panelContainer?.ownerDocument
  try { panelRoot?.unmount() } catch {}
  try { panelContainer?.remove() } catch {}
  try { doc?.getElementById(ACTION_ITEM_ID)?.remove() } catch {}
  panelRoot = null
  panelContainer = null
}

/** Remove the panel and cancel any in-flight mount. */
function unmountPanel() {
  mountGeneration++
  disposeRoot()
}

function createActionStat(doc: Document): HTMLElement {
  const item = doc.createElement("div")
  item.id = ACTION_ITEM_ID
  item.className = "ra-statitem"

  const icon = doc.createElement("div")
  icon.className = "ra-statitem__icon"

  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("width", "22")
  svg.setAttribute("height", "22")
  svg.setAttribute("fill", "currentColor")
  svg.setAttribute("aria-hidden", "true")

  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 18.9V21H7v2h10v-2h-4v-2.1a5.01 5.01 0 0 0 3.61-3.96C19.08 14.63 21 12.55 21 10V8c0-1.1-.9-2-2-2zM5 10V8h2v3.82C5.84 11.4 5 10.3 5 10zm14 0c0 .3-.84 1.4-2 1.82V8h2v2z")
  svg.appendChild(path)
  icon.appendChild(svg)

  const text = doc.createElement("div")
  text.className = "ra-statitem__text"

  const label = doc.createElement("div")
  label.className = "ra-statitem__label"
  label.textContent = t("achievements")

  const value = doc.createElement("div")
  value.className = "ra-statitem__value"

  const bar = doc.createElement("div")
  bar.className = "ra-statitem__bar"

  const fill = doc.createElement("div")
  fill.className = "ra-statitem__fill"
  bar.appendChild(fill)

  text.append(label, value, bar)
  item.append(icon, text)
  return item
}

/**
 * Mirror the panel's progress as a stat in the game hero's action bar.
 * Appends (or updates) an `.ra-statitem` at the end of the stat row; a null
 * progress removes it. The stat row renders well before the achievements
 * fetch resolves, so no polling is needed here.
 */
function renderActionStat(doc: Document, progress: PanelProgress | null) {
  const existing = doc.getElementById(ACTION_ITEM_ID)
  if (!progress) {
    existing?.remove()
    return
  }

  const row = doc.querySelector(ACTION_ROW_SELECTOR)
  if (!row) {
    dbg("action-bar stat row not found — stat skipped")
    return
  }

  ensureStyles(doc)
  const pct = progress.total > 0 ? Math.round((progress.earned / progress.total) * 100) : 0

  let item = existing as HTMLElement | null
  if (!item || item.ownerDocument !== doc) {
    item?.remove()
    item = createActionStat(doc)
  }

  const value = item.querySelector(".ra-statitem__value")
  if (value) value.textContent = `${progress.earned}/${progress.total}`
  const label = item.querySelector(".ra-statitem__label")
  if (label) label.textContent = progress.source === "local" ? t("localAchievements") : t("retroAchievements")
  const fill = item.querySelector(".ra-statitem__fill") as HTMLElement | null
  if (fill) fill.style.width = `${pct}%`

  if (row.lastElementChild !== item) row.appendChild(item)
  dbg(`action-bar stat set: ${progress.earned}/${progress.total} (${pct}%)`)
}

async function mountPanel(appId: string, doc: Document) {
  const myGen = ++mountGeneration

  const info = getSteamAppInfo(appId)
  dbg(`appInfo appId=${appId} name="${info?.name ?? "?"}" shortcut=${info ? info.isShortcut : "unknown"}`)

  // Only show the RA panel for non-Steam shortcuts (retro games added to the
  // library). Native Steam games have their own achievements. If app info is
  // unavailable we fail open and still mount, so the feature isn't silently dead.
  if (info && !info.isShortcut) {
    dbg("native Steam game — RA panel skipped")
    disposeRoot()
    return
  }

  if (isDismissed(appId)) {
    dbg(`game dismissed by user (appId=${appId}) — panel skipped`)
    disposeRoot()
    return
  }

  ensureStyles(doc)

  // The library right panel renders asynchronously after the navigation
  // request finishes. Prefer the notes block when Steam renders it, but fall
  // back to the right-column content on clients where that block is absent or
  // reshuffled (seen on Windows).
  const insertionPoint = await waitForInsertionPoint(doc, INSERTION_POINT_TIMEOUT_MS)
  if (myGen !== mountGeneration) return // a newer navigation superseded us
  if (!insertionPoint) {
    dbg("right-panel anchor not found — panel not mounted")
    return
  }

  // Each game navigation rebuilds the right-panel subtree, orphaning the
  // previous container — recreate when it's missing, detached, or stale.
  if (!panelContainer || panelContainer.ownerDocument !== doc || !doc.contains(panelContainer)) {
    disposeRoot()
    panelContainer = doc.createElement("div")
    panelContainer.id = CONTAINER_ID
    panelContainer.className = "ra-embed"
    const RD = (window as { SP_REACTDOM?: { createRoot: (el: Element) => ReactRoot } }).SP_REACTDOM
    if (!RD) { dbg("SP_REACTDOM unavailable — cannot mount panel"); return }
    panelRoot = RD.createRoot(panelContainer)
  }

  // Place the container at the chosen point, moving it if Steam rebuilt the
  // right-column subtree since the last navigation.
  if (panelContainer.parentElement !== insertionPoint.parent ||
      panelContainer.nextSibling !== insertionPoint.before) {
    insertionPoint.parent.insertBefore(panelContainer, insertionPoint.before)
  }

  // key={appId} forces a fresh AchievementPanel (resets state) per game.
  panelRoot?.render(
    <AchievementPanel
      key={appId}
      appId={appId}
      gameName={info?.name ?? ""}
      doc={doc}
      onProgress={(p) => {
        try {
          renderActionStat(doc, p)
        } catch (e) {
          dbg(`action-bar stat error: ${e instanceof Error ? e.message : String(e)}`)
        }
      }}
      onDismiss={() => {
        try { unmountPanel() } catch {}
      }}
    />,
  )
  dbg(`panel mounted appId=${appId} (${insertionPoint.label})`)
}

// ── Steam UI watcher ───────────────────────────────────────────────────

async function attachSteamUIWatcher(popup: SteamPopup) {
  dbg(`popup created: name="${popup.m_strName}"`)
  if (popup.m_strName !== "SP Desktop_uid0") return

  // SteamUI takes a while to fully initialise after window creation.
  dbg("SteamUI main found, pre-sleep 10s")
  await new Promise((r) => setTimeout(r, 10000))

  // Poll for MainWindowBrowserManager.
  let mwbm: Window["MainWindowBrowserManager"] | undefined
  for (let i = 0; i < 300; i++) {
    mwbm = (window as { MainWindowBrowserManager?: Window["MainWindowBrowserManager"] }).MainWindowBrowserManager
    if (mwbm) break
    if (i % 10 === 0) dbg(`waiting for MWBM... (${i / 10}s elapsed)`)
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!mwbm) { dbg("MWBM NEVER appeared (gave up after 30s)"); return }
  dbg("MWBM found")

  const doc = popup.m_popup?.document ?? document
  dbg(`will inject into doc: ${doc === document ? "self" : "popup"}; body exists: ${!!doc.body}`)

  let currentAppId: string | null = null
  let mountInFlightFor: string | null = null
  const requestMount = (appId: string, reason: string) => {
    if (mountInFlightFor === appId) {
      dbg(`mount already in flight appId=${appId} (${reason})`)
      return
    }
    mountInFlightFor = appId
    mountPanel(appId, doc)
      .catch((e) => dbg(`${reason} error: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        if (mountInFlightFor === appId) mountInFlightFor = null
      })
  }

  const onLocationChange = () => {
    const appId = getAppIdFromUrl(mwbm!.m_lastLocation)
    if (appId === currentAppId) {
      if (appId && (!panelContainer || panelContainer.ownerDocument !== doc || !doc.contains(panelContainer))) {
        dbg(`same appId=${appId} but panel missing — remounting`)
        requestMount(appId, "remount")
      }
      return
    }
    currentAppId = appId
    dbg(`nav → appId=${appId ?? "(none)"}`)
    if (appId) {
      requestMount(appId, "mount")
    } else {
      unmountPanel()
    }
  }
  const heartbeat = window.setInterval(onLocationChange, NAV_HEARTBEAT_MS)
  window.addEventListener("beforeunload", () => window.clearInterval(heartbeat), { once: true })

  try {
    mwbm.m_browser.on("finished-request", onLocationChange)
    dbg("nav listener attached")
  } catch (e) {
    dbg(`listener attach failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  onLocationChange()
}

export default definePlugin(() => {
  dbg(`definePlugin started, location=${typeof location !== "undefined" ? location.pathname : "?"}`)

  try {
    Millennium?.AddWindowCreateHook?.((context: object) => {
      attachSteamUIWatcher(context as unknown as SteamPopup)
        .catch((e) => dbg(`watcher error: ${e instanceof Error ? e.message : String(e)}`))
    })
    dbg("AddWindowCreateHook registered")
  } catch (e) {
    dbg(`AddWindowCreateHook FAILED: ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    title: <div className="ra-panel__title">{t("pluginName")}</div>,
    icon: <div>🏆</div>,
    content: <SettingsPage />,
    onDismount() {
      unmountPanel()
    },
  }
})
