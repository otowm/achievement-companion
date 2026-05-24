import React, { useEffect, useState } from "react"
import { AchievementsResponse, fetchAchievements } from "../api"
import { AchievementsView } from "./AchievementsView"

interface Props {
  raGameId: number
}

export function DirectAchievementsView({ raGameId }: Props) {
  const [data, setData] = useState<AchievementsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    fetchAchievements(raGameId)
      .then((res) => {
        if (cancelled) return
        if (res.status === "ok") {
          setData(res)
        } else {
          setError(res.error ?? "Erro desconhecido")
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [raGameId])

  if (loading) return <div className="ra-spinner" />
  if (error) {
    return (
      <div className="ra-state-card">
        <h4>Erro ao carregar</h4>
        <p>{error}</p>
      </div>
    )
  }
  if (!data || !data.achievements || data.achievements.length === 0) {
    return (
      <div className="ra-state-card">
        <h4>Nenhum achievement</h4>
        <p>Esse RA Game ID não retornou achievements. Verifique o ID em retroachievements.org.</p>
      </div>
    )
  }

  return (
    <div>
      {data.game && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {data.game.icon_url && (
            <img src={data.game.icon_url} alt="" style={{ width: 40, height: 40, borderRadius: 4 }} />
          )}
          <div>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 13 }}>{data.game.title}</div>
            <div style={{ fontSize: 11, color: "var(--SystemDkGrey, #8f98a0)" }}>{data.game.console}</div>
          </div>
        </div>
      )}
      <AchievementsView data={data} />
    </div>
  )
}
