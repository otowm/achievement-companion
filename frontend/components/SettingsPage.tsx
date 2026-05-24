import React, { useEffect, useRef, useState } from "react"
import { searchGames, validateCredentials, Candidate } from "../api"
import {
  clearDismissed,
  AppLanguage,
  DismissedGame,
  getDismissedGames,
  getLanguagePreference,
  getUsername,
  hasApiKey,
  removeDismissed,
  saveCredentials,
  getSteamApiKey,
  isLocalDetectionEnabled,
  saveSteamApiKey,
  setLanguagePreference,
  setLocalDetectionEnabled,
} from "../store"
import { DirectAchievementsView } from "./DirectAchievementsView"
import { ensureStyles } from "../styles/panelCss"
import { getSteamAppInfo } from "../steam"
import { t } from "../i18n"

const DEBUG_LOG_KEY = "ra-achievements.debug-log"

function DebugLog() {
  const [lines, setLines] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const refresh = () => {
      try {
        setLines(JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) ?? "[]"))
      } catch {
        setLines([])
      }
    }
    refresh()
    const id = setInterval(refresh, 500)
    return () => clearInterval(id)
  }, [])

  async function copyLog() {
    const text = lines.join("\n")
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch {}
    if (!ok) {
      try {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        ta.remove()
        ok = true
      } catch {}
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--SystemDkGrey, #8f98a0)" }}>
        {t("pluginLogs", { count: lines.length })}
      </summary>
      <pre
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.3)",
          padding: 6,
          borderRadius: 3,
          maxHeight: 240,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          margin: "6px 0 0",
        }}
      >
        {lines.length === 0 ? t("noLogsYet") : lines.join("\n")}
      </pre>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          className="ra-btn ra-btn--primary"
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={copyLog}
          disabled={lines.length === 0}
        >
          {copied ? t("copied") : t("copyLogs")}
        </button>
        <button
          className="ra-btn"
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={() => { localStorage.removeItem(DEBUG_LOG_KEY); setLines([]) }}
        >
          {t("clearLogs")}
        </button>
      </div>
    </details>
  )
}

export function SettingsPage() {
  const [username, setUsername] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Game viewing state
  const [raGameId, setRaGameId] = useState<number | null>(null)
  const [manualIdInput, setManualIdInput] = useState("")

  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)

  // Steam Web API Key (used to fetch the achievement schema for local games).
  const [steamKey, setSteamKey] = useState("")
  const [steamKeySaved, setSteamKeySaved] = useState(false)
  const [localDetectionEnabled, setLocalDetectionEnabledState] = useState(false)
  const [dismissedGames, setDismissedGames] = useState<DismissedGame[]>([])
  const [language, setLanguageState] = useState<AppLanguage>("auto")

  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setUsername(getUsername())
    setApiKey(hasApiKey() ? "••••••••••••" : "")
    setSteamKey(getSteamApiKey() ? "••••••••••••" : "")
    setLocalDetectionEnabledState(isLocalDetectionEnabled())
    setDismissedGames(getDismissedGames())
    setLanguageState(getLanguagePreference())
    // Styles must land in this component's own document (Millennium settings).
    ensureStyles(rootRef.current?.ownerDocument)
  }, [])

  function handleSaveSteamKey() {
    if (steamKey === "••••••••••••" || !steamKey.trim()) return
    saveSteamApiKey(steamKey.trim())
    setSteamKey("••••••••••••")
    setSteamKeySaved(true)
    setTimeout(() => setSteamKeySaved(false), 1500)
  }

  function handleLocalDetectionToggle(enabled: boolean) {
    setLocalDetectionEnabled(enabled)
    setLocalDetectionEnabledState(enabled)
  }

  function handleRestoreDismissed(appId: string) {
    removeDismissed(appId)
    setDismissedGames(getDismissedGames())
  }

  function handleRestoreAllDismissed() {
    clearDismissed()
    setDismissedGames([])
  }

  function handleLanguageChange(value: AppLanguage) {
    setLanguagePreference(value)
    setLanguageState(value)
  }

  async function handleSave() {
    if (!username || !apiKey || apiKey === "••••••••••••") {
      setStatus({ ok: false, msg: t("fillUserAndKey") })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const res = await validateCredentials(username, apiKey)
      if (res.success) {
        saveCredentials(username, apiKey)
        setApiKey("••••••••••••")
        setStatus({ ok: true, msg: t("connected") })
      } else {
        setStatus({ ok: false, msg: res.error ?? t("unknownError") })
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setStatus({ ok: false, msg: t("ipcError", { detail: detail.slice(0, 200) }) })
    } finally {
      setSaving(false)
    }
  }

  function handleLoadById() {
    const id = parseInt(manualIdInput.trim(), 10)
    if (Number.isFinite(id) && id > 0) {
      setRaGameId(id)
    }
  }

  async function handleSearch() {
    const q = searchQuery.trim()
    if (q.length < 2) return
    setSearching(true)
    try {
      const { results } = await searchGames(q)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const credentialsOk = hasApiKey()

  return (
    <div className="ra-settings" ref={rootRef}>
      {/* Language */}
      <div className="ra-settings__section">
        <div className="ra-settings__label">{t("settingsLanguage")}</div>
        <select
          className="ra-settings__input"
          value={language}
          onChange={(e) => handleLanguageChange(e.currentTarget.value as AppLanguage)}
        >
          <option value="auto">{t("languageAuto")}</option>
          <option value="pt-BR">{t("languagePtBr")}</option>
          <option value="en">{t("languageEn")}</option>
        </select>
      </div>

      {/* Debug log */}
      <div className="ra-settings__section">
        <div className="ra-settings__label">{t("debug")}</div>
        <DebugLog />
      </div>

      {/* Dismissed games */}
      <div className="ra-settings__section">
        <div className="ra-settings__label">{t("ignoredGames")}</div>
        {dismissedGames.length === 0 ? (
          <div className="ra-settings__hint">{t("noIgnoredGames")}</div>
        ) : (
          <>
            <div className="ra-settings__hint">
              {t("restoreHint")}
            </div>
            <div className="ra-dismissed-list">
              {dismissedGames.map((game) => {
                const name = game.name || getSteamAppInfo(game.appId)?.name || t("unnamedGame")
                return (
                <div className="ra-dismissed-list__item" key={game.appId}>
                  <span>
                    <strong>{name}</strong>
                    <small>AppID {game.appId}</small>
                  </span>
                  <button className="ra-btn" onClick={() => handleRestoreDismissed(game.appId)}>
                    {t("restore")}
                  </button>
                </div>
              )})}
            </div>
            <div>
              <button className="ra-btn ra-btn--primary" onClick={handleRestoreAllDismissed}>
                {t("restoreAll")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Credentials */}
      <div className="ra-settings__section">
        <div className="ra-settings__label">{t("raCredentials")}</div>
        <input
          className="ra-settings__input"
          placeholder={t("raUser")}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="ra-settings__input"
          type="password"
          placeholder="API Key"
          value={apiKey}
          onFocus={() => { if (apiKey === "••••••••••••") setApiKey("") }}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <div>
          <button className="ra-btn ra-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? t("validating") : t("saveAndValidate")}
          </button>
        </div>
        {status && (
          <div className={`ra-settings__status ra-settings__status--${status.ok ? "ok" : "error"}`}>
            {status.ok ? "✓ " : "✗ "}{status.msg}
          </div>
        )}
      </div>

      {/* Experimental local achievements */}
      <div className="ra-settings__section">
        <div className="ra-settings__label">{t("localExperimental")}</div>
        <div style={{ fontSize: 11.5, color: "var(--ra-mute, #8b929b)", lineHeight: 1.5 }}>
          {t("localExperimentalHint")}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={localDetectionEnabled}
            onChange={(e) => handleLocalDetectionToggle(e.currentTarget.checked)}
          />
          {t("enableLocalDetection")}
        </label>
        <input
          className="ra-settings__input"
          type="password"
          placeholder={t("key32Placeholder")}
          value={steamKey}
          onFocus={() => { if (steamKey === "••••••••••••") setSteamKey("") }}
          onChange={(e) => setSteamKey(e.target.value)}
        />
        <div>
          <button className="ra-btn ra-btn--primary" onClick={handleSaveSteamKey}>
            {steamKeySaved ? t("saved") : t("save")}
          </button>
        </div>
      </div>

      {credentialsOk && (
        <>
          {/* Direct RA Game ID lookup */}
          <div className="ra-settings__section">
            <div className="ra-settings__label">{t("viewByRaGameId")}</div>
            <div style={{ fontSize: 11, color: "var(--SystemDkGrey, #8f98a0)", marginBottom: 4 }}>
              {t("raGameIdHint")}<b>1234</b>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="ra-settings__input"
                placeholder="ex: 558"
                type="number"
                min={1}
                value={manualIdInput}
                onChange={(e) => setManualIdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLoadById() }}
                style={{ flex: 1 }}
              />
              <button className="ra-btn ra-btn--primary" onClick={handleLoadById}>
                {t("view")}
              </button>
            </div>
          </div>

          {/* Search by name */}
          <div className="ra-settings__section">
            <div className="ra-settings__label">{t("searchGameByNameRa")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="ra-settings__input"
                placeholder="ex: Yoshi"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch() }}
                style={{ flex: 1 }}
              />
              <button className="ra-btn" onClick={handleSearch} disabled={searching}>
                {searching ? "..." : t("searchByName")}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
                {searchResults.map((c) => (
                  <div
                    key={c.id}
                    className="ra-modal__result-item"
                    onClick={() => {
                      setRaGameId(c.id)
                      setManualIdInput(String(c.id))
                    }}
                  >
                    {c.icon && <img className="ra-modal__result-icon" src={c.icon} alt="" />}
                    <div>
                      <div className="ra-modal__result-title">{c.title}</div>
                      <div className="ra-modal__result-console">
                        {c.console} · ID {c.id}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Achievements view */}
          {raGameId && (
            <div className="ra-settings__section">
              <div className="ra-settings__label">{t("achievementsRaGame", { id: raGameId })}</div>
              <DirectAchievementsView key={raGameId} raGameId={raGameId} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
