import React, { useCallback, useEffect, useState } from "react"
import { Button, TextField } from "@steambrew/client"
import { AchievementsView } from "./AchievementsView"
import { GameSearchModal } from "./GameSearchModal"
import {
  AchievementsResponse,
  Candidate,
  fetchAchievements,
  getLocalAchievements,
} from "../api"
import {
  addDismissed,
  getCredentials,
  getLocalSteamAppMapping,
  getMapping,
  isLocalDetectionEnabled,
  getSteamApiKey,
  removeLocalSteamAppMapping,
  removeMapping,
  setLocalSteamAppMapping,
  setMapping,
} from "../store"
import { dbg } from "../log"
import { t } from "../i18n"

type PanelState = "loading" | "ready" | "unlinked" | "error" | "dismissed"

/** Progress pushed up to the host so it can mirror it in the action bar. */
export interface PanelProgress {
  earned: number
  total: number
  source: "ra" | "local"
}

interface Props {
  appId: string
  gameName: string
  doc?: Document
  /** Called with the live progress (or null when there is none to show). */
  onProgress?: (progress: PanelProgress | null) => void
  /** Called when the user dismisses the panel for this game; host should unmount. */
  onDismiss?: () => void
}

export function AchievementPanel({ appId, gameName, doc, onProgress, onDismiss }: Props) {
  const [panelState, setPanelState] = useState<PanelState>("loading")
  const [data, setData] = useState<AchievementsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showLocalEditor, setShowLocalEditor] = useState(false)
  const [showRaEditor, setShowRaEditor] = useState(false)
  const [localSteamAppId, setLocalSteamAppId] = useState("")

  useEffect(() => {
    const mapped = getLocalSteamAppMapping(appId)
    setLocalSteamAppId(mapped ? String(mapped) : "")
  }, [appId])

  const load = useCallback(async () => {
    setPanelState("loading")
    setData(null)
    setError(null)

    // 1. RetroAchievements mapping wins — the user explicitly linked this game.
    const raGameId = getMapping(appId)
    if (raGameId != null) {
      if (!getCredentials()) {
        setError(t("configureRaCredentials"))
        setPanelState("error")
        return
      }
      const ach = await fetchAchievements(raGameId)
      dbg(`RA fetch raGameId=${raGameId} → ${ach.status} (${ach.achievements?.length ?? 0})`)
      if (ach.status === "ok") {
        setData(ach)
        setPanelState("ready")
        return
      }
      setError(ach.error ?? t("fetchRaError"))
      setPanelState("error")
      return
    }

    // 2. Local (Steam-emulator) achievements — only viable with a Steam Web
    //    API key configured (used to fetch the achievement schema).
    if (isLocalDetectionEnabled() && getSteamApiKey()) {
      const local = await getLocalAchievements(appId, gameName)
      dbg(
        `local fetch appId=${appId} -> ${local ? local.status : "skipped"}` +
        `${local?.emulator ? ` emulator=${local.emulator}` : ""}` +
        `${local?.game?.id ? ` steamAppId=${local.game.id}` : ""}` +
        `${local?.schema_missing ? " schema=fallback" : ""}` +
        `${local?.error ? ` error=${local.error}` : ""}` +
        `${local?.schema_error ? ` schema_error=${local.schema_error}` : ""}`,
      )
      if (local && local.status === "ok") {
        setData(local)
        setPanelState("ready")
        return
      }
    }

    // 3. Nothing detected — offer to link RA or dismiss the panel.
    setPanelState("unlinked")
  }, [appId, gameName])

  useEffect(() => { load() }, [load])

  // Mirror progress into the action-bar stat; clear on unmount.
  useEffect(() => {
    if (data?.status === "ok" && data.progress) {
      onProgress?.({
        earned: data.progress.earned,
        total: data.progress.total,
        source: data.source === "local" ? "local" : "ra",
      })
    } else {
      onProgress?.(null)
    }
  }, [data, onProgress])
  useEffect(() => () => onProgress?.(null), [onProgress])

  function handleMapped(candidate: Candidate) {
    setMapping(appId, candidate.id)
    setShowModal(false)
    setShowRaEditor(false)
    load()
  }

  function handleDismiss() {
    addDismissed(appId, gameName)
    setPanelState("dismissed")
    onProgress?.(null)
    onDismiss?.()
  }

  function handleLocalSteamLink() {
    const id = parseInt(localSteamAppId.trim(), 10)
    if (!Number.isFinite(id) || id <= 0) {
      setError(t("invalidSteamAppId"))
      setPanelState("error")
      return
    }
    setLocalSteamAppMapping(appId, id)
    setShowLocalEditor(false)
    load()
  }

  function handleLocalSteamUnlink() {
    removeLocalSteamAppMapping(appId)
    setLocalSteamAppId("")
    setShowLocalEditor(false)
    load()
  }

  function handleRaUnlink() {
    removeMapping(appId)
    setShowRaEditor(false)
    load()
  }

  function renderLocalSteamLink() {
    return (
      <div className="ra-local-link">
        <div style={{ fontSize: 11.5, color: "var(--ra-mute, #8b929b)" }}>
          {t("localSteamHint")}
        </div>
        <div className="ra-local-link__row">
          <TextField
            className="ra-settings__input"
            mustBeNumeric
            label={t("realSteamAppIdPlaceholder")}
            value={localSteamAppId}
            onChange={(e) => setLocalSteamAppId(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLocalSteamLink() }}
          />
          <Button className="ra-btn ra-btn--primary" onClick={handleLocalSteamLink}>
            {t("link")}
          </Button>
          {getLocalSteamAppMapping(appId) != null && (
            <Button className="ra-btn" onClick={handleLocalSteamUnlink}>
              {t("clear")}
            </Button>
          )}
        </div>
      </div>
    )
  }

  function renderRaLinkControls() {
    const raGameId = getMapping(appId)
    return (
      <div className="ra-local-link">
        <div style={{ fontSize: 11.5, color: "var(--ra-mute, #8b929b)" }}>
          {t("currentRaLink", { suffix: raGameId != null ? t("gameIdSuffix", { id: raGameId }) : "" })}
        </div>
        <div className="ra-local-link__row">
          <Button className="ra-btn" onClick={() => setShowModal(true)}>
            {t("changeRa")}
          </Button>
          <Button className="ra-btn" onClick={handleRaUnlink}>
            {t("useLocalAchievements")}
          </Button>
        </div>
      </div>
    )
  }

  if (panelState === "dismissed") return null

  const source: "ra" | "local" = data?.source === "local" ? "local" : "ra"
  const headingLabel = source === "local" ? t("localAchievements") : t("retroAchievements")
  const canEdit = panelState === "ready" || panelState === "unlinked"
  const editTitle = source === "local" && panelState === "ready"
    ? t("changeSteamAppId")
    : t("changeLink")

  return (
    <>
      <div className="ra-panel">
        <div className="ra-panel__head">
          <span className="ra-panel__heading">{headingLabel}</span>
          {canEdit && (
            <Button
              className="ra-panel__edit"
              title={editTitle}
              onClick={() => {
                if (source === "local" && panelState === "ready") {
                  setShowLocalEditor((value) => !value)
                } else if (source === "ra" && panelState === "ready") {
                  setShowRaEditor((value) => !value)
                } else {
                  setShowModal(true)
                }
              }}
            >
              ✎
            </Button>
          )}
        </div>

        {panelState === "loading" && <div className="ra-spinner" />}

        {panelState === "unlinked" && (
          <div className="ra-panel__compact">
            <span>{t("unlinkedQuestion")}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button className="ra-btn ra-btn--primary" onClick={() => setShowModal(true)}>
                {t("linkToRa")}
              </Button>
              <Button className="ra-btn" onClick={handleDismiss}>
                {t("notRaGame")}
              </Button>
            </div>
            {!isLocalDetectionEnabled() && (
              <div style={{ fontSize: 11.5, color: "var(--ra-mute, #8b929b)", marginTop: 4 }}>
                {t("localDetectionOff")}
              </div>
            )}
            {isLocalDetectionEnabled() && !getSteamApiKey() && (
              <div style={{ fontSize: 11.5, color: "var(--ra-mute, #8b929b)", marginTop: 4 }}>
                {t("localDetectionNeedsKey")}
              </div>
            )}
            {isLocalDetectionEnabled() && getSteamApiKey() && renderLocalSteamLink()}
          </div>
        )}

        {panelState === "error" && (
          <div className="ra-panel__compact">
            <span>{error ?? t("loadAchievementsError")}</span>
            <Button className="ra-btn" onClick={load}>{t("retry")}</Button>
          </div>
        )}

        {panelState === "ready" && data && (
          <>
            <AchievementsView data={data} source={source} />
            {showLocalEditor && renderLocalSteamLink()}
            {showRaEditor && renderRaLinkControls()}
          </>
        )}
      </div>

      {showModal && (
        <GameSearchModal
          doc={doc}
          onClose={() => setShowModal(false)}
          onSelect={handleMapped}
        />
      )}
    </>
  )
}
