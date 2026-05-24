import React, { useEffect, useRef, useState } from "react"
import { Button, Dropdown, Field, TextField, ToggleField } from "@steambrew/client"
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
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch {}
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
        <Button
          className="ra-btn ra-btn--primary"
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={copyLog}
          disabled={lines.length === 0}
        >
          {copied ? t("copied") : t("copyLogs")}
        </Button>
        <Button
          className="ra-btn"
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={() => { localStorage.removeItem(DEBUG_LOG_KEY); setLines([]) }}
        >
          {t("clearLogs")}
        </Button>
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
      <Field label={t("settingsLanguage")} bottomSeparator="standard">
        <Dropdown
          rgOptions={[
            { data: "auto", label: t("languageAuto") },
            { data: "pt-BR", label: t("languagePtBr") },
            { data: "en", label: t("languageEn") },
          ]}
          selectedOption={language}
          onChange={(option) => handleLanguageChange(option.data as AppLanguage)}
        />
      </Field>

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
                  <Button className="ra-btn" onClick={() => handleRestoreDismissed(game.appId)}>
                    {t("restore")}
                  </Button>
                </div>
              )})}
            </div>
            <div>
              <Button className="ra-btn ra-btn--primary" onClick={handleRestoreAllDismissed}>
                {t("restoreAll")}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Credentials */}
      <div className="ra-settings__section">
        <div className="ra-settings__label">{t("raCredentials")}</div>
        <TextField
          className="ra-settings__input"
          label={t("raUser")}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          className="ra-settings__input"
          bIsPassword
          label="API Key"
          value={apiKey}
          onFocus={() => { if (apiKey === "••••••••••••") setApiKey("") }}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <div>
          <Button className="ra-btn ra-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? t("validating") : t("saveAndValidate")}
          </Button>
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
        <ToggleField
          label={t("enableLocalDetection")}
          checked={localDetectionEnabled}
          onChange={handleLocalDetectionToggle}
        />
        <TextField
          className="ra-settings__input"
          bIsPassword
          label={t("key32Placeholder")}
          value={steamKey}
          onFocus={() => { if (steamKey === "••••••••••••") setSteamKey("") }}
          onChange={(e) => setSteamKey(e.target.value)}
        />
        <div>
          <Button className="ra-btn ra-btn--primary" onClick={handleSaveSteamKey}>
            {steamKeySaved ? t("saved") : t("save")}
          </Button>
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
              <TextField
                className="ra-settings__input"
                label="ex: 558"
                mustBeNumeric
                value={manualIdInput}
                onChange={(e) => setManualIdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLoadById() }}
                style={{ flex: 1 }}
              />
              <Button className="ra-btn ra-btn--primary" onClick={handleLoadById}>
                {t("view")}
              </Button>
            </div>
          </div>

          {/* Search by name */}
          <div className="ra-settings__section">
            <div className="ra-settings__label">{t("searchGameByNameRa")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <TextField
                className="ra-settings__input"
                label="ex: Yoshi"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch() }}
                style={{ flex: 1 }}
              />
              <Button className="ra-btn" onClick={handleSearch} disabled={searching}>
                {searching ? "..." : t("searchByName")}
              </Button>
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
