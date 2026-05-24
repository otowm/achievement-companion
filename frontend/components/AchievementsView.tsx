import React, { useState } from "react"
import { Achievement, AchievementsResponse } from "../api"
import { t } from "../i18n"

// How many locked achievements to show before collapsing the rest into "+N".
const LOCKED_PREVIEW = 7

function percentOf(earned: number, total: number): number {
  return total > 0 ? Math.round((earned / total) * 100) : 0
}

function achievementDescription(a: Achievement): string {
  return (a.description ?? "").trim()
}

function unlockTime(a: Achievement): number {
  if (!a.date_earned) return 0
  const time = Date.parse(a.date_earned)
  return Number.isFinite(time) ? time : 0
}

type LocalSortMode = "recent" | "oldest" | "game" | "name"
type AchievementSource = "ra" | "local"
type HoverCardState = { achievement: Achievement; x: number; y: number }

const HOVER_CARD_ID = "ra-achievement-hover-card"
let hoverCardDoc: Document | null = null

function createPortal(node: React.ReactElement, _container?: Element): React.ReactElement {
  return node
}

function sortLocalAchievements(achievements: Achievement[], mode: LocalSortMode): Achievement[] {
  const byGameOrder = (a: Achievement, b: Achievement) => a.display_order - b.display_order
  const sorted = [...achievements]

  if (mode === "name") {
    return sorted.sort((a, b) => a.title.localeCompare(b.title, "pt-BR") || byGameOrder(a, b))
  }

  if (mode === "recent" || mode === "oldest") {
    return sorted.sort((a, b) => {
      if (a.earned !== b.earned) return a.earned ? -1 : 1
      const byDate = mode === "recent" ? unlockTime(b) - unlockTime(a) : unlockTime(a) - unlockTime(b)
      if (byDate !== 0) return byDate
      return byGameOrder(a, b)
    })
  }

  return sorted.sort(byGameOrder)
}

function tooltipPosition(e: React.MouseEvent<HTMLElement>): { x: number; y: number } {
  const cardWidth = 360
  const cardHeight = 150
  const gap = 12
  const margin = 8
  const doc = e.currentTarget.ownerDocument
  const win = doc.defaultView ?? window
  const root = doc.documentElement
  const body = doc.body
  const viewportWidth = Math.max(win.innerWidth || 0, root.clientWidth || 0, body?.clientWidth || 0, 1280)
  const viewportHeight = Math.max(win.innerHeight || 0, root.clientHeight || 0, body?.clientHeight || 0, 720)
  let x = e.clientX + gap
  let y = e.clientY - 24

  if (x + cardWidth > viewportWidth - margin) x = e.clientX - cardWidth - gap
  if (y + cardHeight > viewportHeight - margin) y = viewportHeight - cardHeight - margin

  return { x: Math.max(margin, x), y: Math.max(margin, y) }
}

function formatUnlockDate(date: string | null): string {
  if (!date) return ""
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}

function HoverAchievementCard({ state }: { state: HoverCardState }) {
  const achievement = state.achievement
  const src = achievement.earned ? achievement.badge_url : achievement.badge_locked_url
  const description = achievementDescription(achievement)
  const awarded = achievement.num_awarded > 0
    ? t("awardedBy", { count: achievement.num_awarded.toLocaleString("pt-BR") })
    : ""
  const status = achievement.earned
    ? `Alcançada${achievement.date_earned ? ` em ${formatUnlockDate(achievement.date_earned)}` : ""}`
    : "Ainda bloqueada"

  const statusText = achievement.earned
    ? (achievement.date_earned ? t("achievedOn", { date: formatUnlockDate(achievement.date_earned) }) : t("achieved"))
    : t("stillLocked")

  return createPortal((
    <div className="ra-hover-card" style={{ left: state.x, top: state.y }}>
      {src ? (
        <img className={`ra-hover-card__icon${achievement.earned ? "" : " ra-hover-card__icon--locked"}`} src={src} alt="" />
      ) : (
        <div className={`ra-hover-card__icon ra-hover-card__icon--text${achievement.earned ? "" : " ra-hover-card__icon--locked"}`}>
          {achievement.title.slice(0, 3).toUpperCase()}
        </div>
      )}
      <div className="ra-hover-card__body">
        <div className="ra-hover-card__title">{achievement.title}</div>
        {description && <div className="ra-hover-card__desc">{description}</div>}
        <div className="ra-hover-card__meta">
          <div>{statusText}</div>
          {awarded && <div>{awarded}</div>}
        </div>
      </div>
    </div>
  ), document.body)
}

function makeText(doc: Document, className: string, text: string): HTMLElement {
  const el = doc.createElement("div")
  el.className = className
  el.textContent = text
  return el
}

function positionImperativeHover(card: HTMLElement, e: React.MouseEvent<HTMLElement>): void {
  const { x, y } = tooltipPosition(e)
  card.style.left = `${x}px`
  card.style.top = `${y}px`
}

function showImperativeHover(achievement: Achievement, e: React.MouseEvent<HTMLElement>): void {
  const doc = e.currentTarget.ownerDocument
  const src = achievement.earned ? achievement.badge_url : achievement.badge_locked_url
  const description = achievementDescription(achievement)
  const awarded = achievement.num_awarded > 0
    ? t("awardedBy", { count: achievement.num_awarded.toLocaleString("pt-BR") })
    : ""
  const statusText = achievement.earned
    ? (achievement.date_earned ? t("achievedOn", { date: formatUnlockDate(achievement.date_earned) }) : t("achieved"))
    : t("stillLocked")

  hideImperativeHover()
  hoverCardDoc = doc

  const card = doc.createElement("div")
  card.id = HOVER_CARD_ID
  card.className = "ra-hover-card"

  if (src) {
    const icon = doc.createElement("img")
    icon.className = `ra-hover-card__icon${achievement.earned ? "" : " ra-hover-card__icon--locked"}`
    icon.src = src
    icon.alt = ""
    card.appendChild(icon)
  } else {
    card.appendChild(makeText(
      doc,
      `ra-hover-card__icon ra-hover-card__icon--text${achievement.earned ? "" : " ra-hover-card__icon--locked"}`,
      achievement.title.slice(0, 3).toUpperCase(),
    ))
  }

  const body = doc.createElement("div")
  body.className = "ra-hover-card__body"
  body.appendChild(makeText(doc, "ra-hover-card__title", achievement.title))
  if (description) body.appendChild(makeText(doc, "ra-hover-card__desc", description))

  const meta = doc.createElement("div")
  meta.className = "ra-hover-card__meta"
  meta.appendChild(makeText(doc, "", statusText))
  if (awarded) meta.appendChild(makeText(doc, "", awarded))
  body.appendChild(meta)
  card.appendChild(body)

  positionImperativeHover(card, e)
  doc.body.appendChild(card)
}

function moveImperativeHover(e: React.MouseEvent<HTMLElement>): void {
  const card = e.currentTarget.ownerDocument.getElementById(HOVER_CARD_ID)
  if (card) positionImperativeHover(card, e)
}

function hideImperativeHover(): void {
  hoverCardDoc?.getElementById(HOVER_CARD_ID)?.remove()
  hoverCardDoc = null
}

function Badge({
  a,
  source,
  onHover,
  onHoverMove,
  onHoverEnd,
}: {
  a: Achievement
  source: AchievementSource
  onHover?: (achievement: Achievement, source: AchievementSource, e: React.MouseEvent<HTMLElement>) => void
  onHoverMove?: (e: React.MouseEvent<HTMLElement>) => void
  onHoverEnd?: () => void
}) {
  const src = a.earned ? a.badge_url : a.badge_locked_url
  const hoverProps = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.removeAttribute("title")
      onHover?.(a, source, e)
    },
    onMouseMove: onHoverMove,
    onMouseLeave: onHoverEnd,
  }

  if (!src) {
    return (
      <div
        className={`ra-badge ra-badge--text${a.earned ? "" : " ra-badge--locked"}`}
        {...hoverProps}
      >
        {a.title.slice(0, 3).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      className={`ra-badge${a.earned ? "" : " ra-badge--locked"}`}
      src={src}
      alt={a.title}
      title={a.description ? `${a.title} — ${a.description}` : a.title}
      loading="lazy"
      {...hoverProps}
      onError={(e) => {
        const img = e.currentTarget
        if (!img.src.includes("_lock") && a.badge_locked_url) img.src = a.badge_locked_url
      }}
    />
  )
}

interface Props {
  data: AchievementsResponse
  /** "ra" = RetroAchievements (default), "local" = Steam emulator (Goldberg/RUNE). */
  source?: "ra" | "local"
}

function AchievementDetailsModal({
  data,
  source,
  onClose,
}: {
  data: AchievementsResponse
  source: "ra" | "local"
  onClose: () => void
}) {
  const [localSortMode, setLocalSortMode] = useState<LocalSortMode>("recent")
  const achievements = source === "local"
    ? sortLocalAchievements(data.achievements ?? [], localSortMode)
    : [...(data.achievements ?? [])].sort((a, b) => a.display_order - b.display_order)
  const url = data.game && source === "ra" ? `https://retroachievements.org/game/${data.game.id}` : ""

  return (
    <div className="ra-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`ra-modal ${source === "ra" ? "ra-modal--browser" : "ra-modal--wide"}`}>
        <div className="ra-modal__header">
          <span className="ra-modal__title">
            {source === "local" ? data.game?.title ?? t("localAchievements") : t("retroAchievements")}
          </span>
          <button className="ra-modal__close" onClick={onClose}>x</button>
        </div>
        {source === "ra" && url ? (
          <iframe className="ra-popup-frame" src={url} title="RetroAchievements" />
        ) : (
          <div className="ra-modal__body">
            <div className="ra-local-ach-toolbar">
              <span className="ra-local-ach-toolbar__label">{t("countAchievements", { count: achievements.length })}</span>
              <select
                className="ra-local-ach-toolbar__select"
                value={localSortMode}
                onChange={(e) => setLocalSortMode(e.currentTarget.value as LocalSortMode)}
              >
                <option value="recent">{t("mostRecent")}</option>
                <option value="oldest">{t("oldest")}</option>
                <option value="game">{t("gameOrder")}</option>
                <option value="name">{t("name")}</option>
              </select>
            </div>
            <div className="ra-local-ach-list">
              {achievements.map((achievement) => {
                const description = achievementDescription(achievement)
                return (
                  <div
                    className="ra-local-ach-list__item"
                    key={achievement.id}
                  >
                    <Badge a={achievement} source={source} />
                    <div className="ra-local-ach-list__meta">
                      <div className="ra-modal__result-title">{achievement.title}</div>
                      {description && (
                        <div className="ra-local-ach-list__description">{description}</div>
                      )}
                      <div className="ra-modal__result-console">
                        {achievement.earned ? t("unlocked") : t("locked")}
                        {achievement.date_earned ? ` - ${achievement.date_earned}` : ""}
                      </div>
                    </div>
                  </div>
                )
              })}
              {achievements.length === 0 && (
                <div className="ra-ach__label">{t("noLocalAchievements")}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Steam-native achievements layout: progress summary + bar, the most recent
 * unlock featured, a row of the other unlocked badges, then the locked ones
 * under "Conquistas para alcançar", and a link out to RetroAchievements.
 */
export function AchievementsView({ data, source = "ra" }: Props) {
  const [showDetails, setShowDetails] = useState(false)
  const achievements = data.achievements ?? []
  const earned = data.progress?.earned ?? achievements.filter((a) => a.earned).length
  const total = data.progress?.total ?? achievements.length
  const pct = percentOf(earned, total)

  const sorted = [...achievements].sort((a, b) => a.display_order - b.display_order)

  // Featured = most recently unlocked; the rest of the unlocked sit in a row.
  const unlocked = sorted
    .filter((a) => a.earned)
    .sort((a, b) => (b.date_earned ?? "").localeCompare(a.date_earned ?? ""))
  const featured = unlocked[0] ?? null
  const unlockedRest = featured ? unlocked.filter((a) => a.id !== featured.id) : unlocked

  const locked = sorted.filter((a) => !a.earned)
  const lockedShown = locked.slice(0, LOCKED_PREVIEW)
  const lockedMore = locked.length - lockedShown.length
  const showHover = (achievement: Achievement, hoverSource: AchievementSource, e: React.MouseEvent<HTMLElement>) => {
    showImperativeHover(achievement, e)
  }
  const moveHover = (e: React.MouseEvent<HTMLElement>) => {
    moveImperativeHover(e)
  }

  return (
    <div className="ra-ach">
      <div className="ra-ach__summary">
        <span className="ra-ach__count">{earned}/{total}</span> {t("reached")}
        <span className="ra-ach__pct"> ({pct}%)</span>
      </div>
      <div className="ra-ach__bar">
        <div className="ra-ach__fill" style={{ width: `${pct}%` }} />
      </div>

      {featured && (
        <div
          className="ra-feat"
          onMouseEnter={(e) => showHover(featured, source, e)}
          onMouseMove={moveHover}
          onMouseLeave={hideImperativeHover}
        >
          {featured.badge_url ? (
            <img
              className="ra-feat__icon"
              src={featured.badge_url}
              alt=""
              onError={(e) => { e.currentTarget.style.visibility = "hidden" }}
            />
          ) : (
            <div className="ra-feat__icon ra-feat__icon--text">
              {featured.title.slice(0, 3).toUpperCase()}
            </div>
          )}
          <div className="ra-feat__body">
            <div className="ra-feat__title">{featured.title}</div>
            <div className="ra-feat__desc">{featured.description || "—"}</div>
          </div>
        </div>
      )}

      {unlockedRest.length > 0 && (
        <div className="ra-row">
          {unlockedRest.map((a) => (
            <Badge
              key={a.id}
              a={a}
              source={source}
              onHover={showHover}
              onHoverMove={moveHover}
              onHoverEnd={hideImperativeHover}
            />
          ))}
        </div>
      )}

      {locked.length > 0 && (
        <>
          <div className="ra-ach__divider" />
          <div className="ra-ach__label">{t("achievementsToGet")}</div>
          <div className="ra-row">
            {lockedShown.map((a) => (
              <Badge
                key={a.id}
                a={a}
                source={source}
                onHover={showHover}
                onHoverMove={moveHover}
                onHoverEnd={hideImperativeHover}
              />
            ))}
            {lockedMore > 0 && <div className="ra-more">+{lockedMore}</div>}
          </div>
        </>
      )}

      {achievements.length === 0 && (
        <div className="ra-ach__label">{t("noAchievements")}</div>
      )}

      {data.game && (
        <div className="ra-ach__foot">
          <button
            className="ra-ach__link"
            onClick={() => {
              if (source === "local") {
                setShowDetails(true)
                return
              }
              try {
                window.open(`https://retroachievements.org/game/${data.game!.id}`, "_blank")
              } catch {}
            }}
          >
            {source === "local" ? t("viewLocal") : t("viewRetroAchievements")}
          </button>
        </div>
      )}
      {source === "local" && showDetails && (
        <AchievementDetailsModal
          data={data}
          source={source}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  )
}
