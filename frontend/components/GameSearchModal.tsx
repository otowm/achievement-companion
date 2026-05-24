import React, { useEffect, useRef, useState } from "react"
import { Button, TextField } from "@steambrew/client"
import { Candidate, RaConsole, getRaConsoles, searchConsoleGames } from "../api"
import { t } from "../i18n"

interface Props {
  initialCandidates?: Candidate[]
  /** Document the modal should portal into (the game-page document). */
  doc?: Document
  onClose: () => void
  onSelect: (candidate: Candidate) => void
}

type Tab = "search" | "manual"

type ConsoleGroup = {
  title: string
  consoles: RaConsole[]
}

type ConsoleGroupRule = {
  title: string
  keys: string[]
}

// The RA console list rarely changes, so cache it between sessions.
const CONSOLES_CACHE_KEY = "ra-achievements.consoles"

const CONSOLE_GROUP_RULES: ConsoleGroupRule[] = [
  {
    title: "Nintendo",
    keys: [
      "nes",
      "famicom",
      "super famicom",
      "snes",
      "nintendo",
      "gamecube",
      "wii",
      "game boy",
      "pokemon mini",
      "virtual boy",
    ],
  },
  {
    title: "Sega",
    keys: [
      "sega",
      "sg 1000",
      "master system",
      "genesis",
      "mega drive",
      "mega cd",
      "32x",
      "saturn",
      "dreamcast",
      "game gear",
    ],
  },
  {
    title: "Sony",
    keys: ["playstation", "psp"],
  },
  {
    title: "Atari",
    keys: ["atari", "lynx", "jaguar"],
  },
  {
    title: "NEC",
    keys: ["pc engine", "turbografx", "pc fx", "pc 8000", "pc 8800"],
  },
  {
    title: "SNK",
    keys: ["neo geo"],
  },
]

function normalizeConsoleName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function consoleGroupTitle(consoleName: string): string {
  const normalized = normalizeConsoleName(consoleName)
  for (const group of CONSOLE_GROUP_RULES) {
    if (group.keys.some((key) => normalized.includes(key))) return group.title
  }
  return "Others"
}

function consoleIconLabel(consoleName: string): string {
  const normalized = normalizeConsoleName(consoleName)
  if (normalized.includes("playstation")) return "PS"
  if (normalized.includes("game boy advance")) return "GBA"
  if (normalized.includes("game boy color")) return "GBC"
  if (normalized.includes("game boy")) return "GB"
  if (normalized.includes("snes") || normalized.includes("super famicom")) return "SFC"
  if (normalized.includes("nes") || normalized.includes("famicom")) return "FC"
  if (normalized.includes("nintendo 64")) return "N64"
  if (normalized.includes("gamecube")) return "GC"
  if (normalized.includes("wii")) return "Wii"
  if (normalized.includes("master system")) return "MS"
  if (normalized.includes("genesis") || normalized.includes("mega drive")) return "MD"
  if (normalized.includes("dreamcast")) return "DC"
  if (normalized.includes("saturn")) return "SAT"
  if (normalized.includes("game gear")) return "GG"
  if (normalized.includes("neo geo")) return "NG"
  if (normalized.includes("pc engine") || normalized.includes("turbografx")) return "PCE"
  if (normalized.includes("atari")) return "A"
  if (normalized.includes("arcade")) return "AC"
  return consoleName.slice(0, 3).toUpperCase()
}

function groupConsoles(consoles: RaConsole[]): ConsoleGroup[] {
  const groups = new Map<string, RaConsole[]>()
  for (const rule of CONSOLE_GROUP_RULES) groups.set(rule.title, [])
  groups.set("Others", [])

  for (const consoleItem of consoles) {
    const title = consoleGroupTitle(consoleItem.name)
    groups.get(title)?.push(consoleItem)
  }

  return Array.from(groups.entries())
    .map(([title, list]) => ({ title, consoles: list }))
    .filter((group) => group.consoles.length > 0)
}

function loadCachedConsoles(): RaConsole[] {
  try {
    const v = JSON.parse(localStorage.getItem(CONSOLES_CACHE_KEY) ?? "[]")
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function cacheConsoles(list: RaConsole[]): void {
  try { localStorage.setItem(CONSOLES_CACHE_KEY, JSON.stringify(list)) } catch {}
}

export function GameSearchModal({ initialCandidates = [], doc, onClose, onSelect }: Props) {
  const safeInitial = Array.isArray(initialCandidates) ? initialCandidates : []
  const [tab, setTab] = useState<Tab>("search")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Candidate[]>(safeInitial)
  const [diag, setDiag] = useState("")
  const [manualId, setManualId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [consoles, setConsoles] = useState<RaConsole[]>(loadCachedConsoles())
  const [consoleId, setConsoleId] = useState<number | null>(null)
  const [consolesLoading, setConsolesLoading] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedConsoleName = consoles.find((c) => c.id === consoleId)?.name ?? ""
  const consoleGroups = groupConsoles(consoles)

  // Load the console list once (served from the localStorage cache when present).
  useEffect(() => {
    if (consoles.length) return
    setConsolesLoading(true)
    getRaConsoles()
      .then((list) => {
        if (list.length) { setConsoles(list); cacheConsoles(list) }
      })
      .finally(() => setConsolesLoading(false))
  }, [])

  // Debounced search within the selected console.
  useEffect(() => {
    if (tab !== "search") return
    if (consoleId == null || query.trim().length < 2) {
      setResults(safeInitial)
      setDiag("")
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const { results: r, diag: d } = await searchConsoleGames(consoleId, query.trim())
        setResults(r)
        setDiag(d)
      } catch (e) {
        setError(t("searchGamesError"))
        setDiag(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, tab, consoleId])

  function handleManualConfirm() {
    const id = parseInt(manualId, 10)
    if (!id || isNaN(id)) {
      setError(t("invalidId"))
      return
    }
    onSelect({ id, title: "", console: "", icon: "" })
  }

  const overlay = (
    <div className="ra-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`ra-modal${tab === "search" ? " ra-modal--wide" : ""}`}>
        <div className="ra-modal__header">
          <span className="ra-modal__title">{t("linkToRetroAchievements")}</span>
          <Button className="ra-modal__close" onClick={onClose}>×</Button>
        </div>
        <div className="ra-modal__tabs">
          {(["search", "manual"] as Tab[]).map((tabName) => (
            <Button
              key={tabName}
              className={`ra-modal__tab${tab === tabName ? " ra-modal__tab--active" : ""}`}
              onClick={() => { setTab(tabName); setError(null) }}
            >
              {tabName === "search" ? t("searchByName") : t("pasteId")}
            </Button>
          ))}
        </div>

        <div className="ra-modal__body">
          {tab === "search" && (
            <>
              <div className="ra-console-picker">
                {consolesLoading && consoles.length === 0 ? (
                  <div className="ra-console-picker__empty">{t("loadingConsoles")}</div>
                ) : (
                  consoleGroups.map((group) => (
                    <div className="ra-console-picker__group" key={group.title}>
                      <div className="ra-console-picker__title">{group.title}</div>
                      {group.consoles.map((consoleItem) => (
                        <Button
                          key={consoleItem.id}
                          type="button"
                          className={`ra-console-picker__item${
                            consoleId === consoleItem.id ? " ra-console-picker__item--active" : ""
                          }`}
                          onClick={() => setConsoleId(consoleItem.id)}
                        >
                          <span className="ra-console-picker__icon">{consoleIconLabel(consoleItem.name)}</span>
                          {consoleItem.name}
                        </Button>
                      ))}
                    </div>
                  ))
                )}
              </div>
              {selectedConsoleName && (
                <div className="ra-console-picker__selected">
                  {t("selectedSystem")} <strong>{selectedConsoleName}</strong>
                </div>
              )}
              <TextField
                className="ra-modal__input"
                label={consoleId == null ? t("chooseSystemFirst") : t("gameNamePlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={consoleId == null}
                autoFocus
              />
              {loading && <div className="ra-spinner" />}
              {!loading && results.map((c) => (
                <div key={c.id} className="ra-modal__result-item" onClick={() => onSelect(c)}>
                  {c.icon && <img className="ra-modal__result-icon" src={c.icon} alt="" />}
                  <div>
                    <div className="ra-modal__result-title">{c.title}</div>
                    <div className="ra-modal__result-console">
                      {c.console}{c.id ? ` · ID ${c.id}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {!loading && consoleId != null && results.length === 0 && query.trim().length >= 2 && (
                <>
                  <div style={{ fontSize: 12, textAlign: "center", color: "#8b929b" }}>
                    {t("noConsoleResults", { tab: t("pasteId") })}
                  </div>
                  {diag && <div className="ra-modal__diag">{diag}</div>}
                </>
              )}
            </>
          )}

          {tab === "manual" && (
            <>
              <label style={{ fontSize: 12, color: "#9aa6b2", lineHeight: 1.5 }}>
                {t("pasteRaGameNumber")}
                <br />
                <span style={{ opacity: 0.7 }}>
                  {t("raUrlHint")}<strong>1446</strong>
                </span>
              </label>
              <TextField
                className="ra-modal__input"
                mustBeNumeric
                label="ex: 1446"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleManualConfirm() }}
                autoFocus
              />
            </>
          )}

          {error && <div style={{ color: "#e8615f", fontSize: 12 }}>{error}</div>}
        </div>

        <div className="ra-modal__footer">
          <Button className="ra-btn" onClick={onClose}>{t("cancel")}</Button>
          {tab === "manual" && (
            <Button className="ra-btn ra-btn--primary" onClick={handleManualConfirm} disabled={loading}>
              {t("confirm")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  // Portal into the game-page document body so the modal escapes the
  // panel's stacking/scroll context instead of vanishing inside it.
  const RD = (window as {
    SP_REACTDOM?: { createPortal?: (n: React.ReactNode, c: Element) => React.ReactElement }
  }).SP_REACTDOM
  const target = doc?.body
  if (RD?.createPortal && target) {
    return RD.createPortal(overlay, target)
  }
  return overlay
}
