// Single source of truth for plugin CSS.
//
// The plugin's JS runs in Millennium's SharedJSContext, but the game-page
// panel is mounted into the SP Desktop window's document — a *different*
// document. The bundler's CSS-injection only reaches the SharedJSContext,
// so we ship the CSS as a string and inject a <style> into whichever
// document we render into. ensureStyles() is idempotent (keyed by id).
//
// The look mirrors Steam's native library "CONQUISTAS" panel: neutral dark
// card surface, Steam-blue progress, no custom branding chrome.

const STYLE_ID = "ra-panel-styles"

export const PANEL_CSS = `
/* ════════════════════════════════════════════════════════════════
   RetroAchievements — Steam-native theme.
   Palette vars sit on :root so they reach every document we inject
   into (game-page panel, action-bar stat, settings page, modal).
   ════════════════════════════════════════════════════════════════ */
:root {
  --ra-bg-1: #2b2f37;
  --ra-bg-2: #22252b;
  --ra-line: rgba(255, 255, 255, 0.07);
  --ra-surface: rgba(255, 255, 255, 0.04);
  --ra-text: #c6d4df;
  --ra-mute: #8b929b;
  --ra-white: #ffffff;
  --ra-blue: #1a9fff;
  --ra-blue-deep: #1c6fb8;
  --ra-blue-light: #67c1f5;
}

/* ── Embedded panel: a Steam library right-column card ──────────── */
.ra-embed {
  width: 100%;
  margin: 0 0 12px;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(180deg, var(--ra-bg-1), var(--ra-bg-2));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  color: var(--ra-text);
  font-family: "Motiva Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  animation: ra-embed-in 0.2s ease;
}
.ra-embed * { box-sizing: border-box; }
@keyframes ra-embed-in { from { opacity: 0; } to { opacity: 1; } }

/* ── Panel chrome ───────────────────────────────────────────────── */
.ra-panel { padding: 13px 14px 14px; }

.ra-panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 11px;
}
.ra-panel__heading {
  flex: 1;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ra-mute);
}
.ra-panel__edit {
  border: none;
  background: none;
  padding: 2px 5px;
  border-radius: 3px;
  color: var(--ra-mute);
  font-size: 12px;
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.12s, background 0.12s;
}
.ra-panel__edit:hover { opacity: 1; background: rgba(255, 255, 255, 0.08); }

/* ── Achievements view: summary + progress ──────────────────────── */
.ra-ach__summary {
  font-size: 13px;
  color: var(--ra-text);
  margin-bottom: 7px;
}
.ra-ach__count { font-weight: 700; color: var(--ra-white); }
.ra-ach__pct { color: var(--ra-mute); }

.ra-ach__bar {
  height: 8px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.45);
  overflow: hidden;
  margin-bottom: 14px;
}
.ra-ach__fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--ra-blue-deep), var(--ra-blue));
  box-shadow: 0 0 6px rgba(26, 159, 255, 0.45);
  transform-origin: left;
  animation: ra-fill 0.7s cubic-bezier(0.2, 0.8, 0.3, 1) both;
}
@keyframes ra-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* ── Featured (most recent) achievement ─────────────────────────── */
.ra-feat {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 12px;
}
.ra-feat__icon {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: 3px;
  image-rendering: pixelated;
  background: rgba(0, 0, 0, 0.3);
}
.ra-feat__body { min-width: 0; }
.ra-feat__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ra-white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ra-feat__desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ra-mute);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Badge rows ─────────────────────────────────────────────────── */
.ra-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ra-badge {
  width: 44px;
  height: 44px;
  border-radius: 3px;
  image-rendering: pixelated;
  background: rgba(0, 0, 0, 0.3);
  transition: transform 0.12s ease;
}
.ra-badge:hover { transform: scale(1.09); }
.ra-badge--locked { filter: brightness(0.72) grayscale(0.25); }
.ra-badge--text,
.ra-feat__icon--text {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 159, 255, 0.14);
  border: 1px solid rgba(103, 193, 245, 0.26);
  color: var(--ra-blue-light, #67c1f5);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
}
.ra-more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 44px;
  padding: 0 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ra-mute);
}

/* ── Section sub-label, divider, footer ─────────────────────────── */
.ra-hover-card {
  position: fixed;
  z-index: 2147483647;
  width: 360px;
  min-height: 126px;
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 13px;
  padding: 16px 16px 14px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: linear-gradient(180deg, #333943, #282d35);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  color: var(--ra-text, #c6d4df);
  pointer-events: none;
}
.ra-hover-card__icon {
  width: 92px;
  height: 92px;
  object-fit: cover;
  image-rendering: pixelated;
  background: rgba(0, 0, 0, 0.24);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.ra-hover-card__icon--locked {
  filter: grayscale(1);
  opacity: 0.78;
}
.ra-hover-card__icon--text {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d7e5ef;
  font-size: 20px;
  font-weight: 800;
}
.ra-hover-card__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ra-hover-card__title {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.25;
}
.ra-hover-card__desc {
  margin-top: 6px;
  color: #aeb8c2;
  font-size: 13px;
  line-height: 1.35;
}
.ra-hover-card__meta {
  margin-top: auto;
  padding: 9px 10px;
  background: rgba(0, 0, 0, 0.24);
  color: #9fa8b2;
  font-size: 12px;
  line-height: 1.45;
}

.ra-ach__divider {
  height: 1px;
  background: var(--ra-line);
  margin: 12px 0;
}
.ra-ach__label {
  font-size: 12px;
  color: var(--ra-mute);
  margin-bottom: 8px;
}
.ra-ach__foot {
  margin-top: 12px;
  text-align: right;
}
.ra-ach__link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--ra-mute);
  cursor: pointer;
  transition: color 0.12s;
}
.ra-ach__link:hover { color: var(--ra-white); }

/* ── Compact state bodies ───────────────────────────────────────── */
.ra-panel__compact {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ra-text);
}
.ra-panel__compact strong { color: var(--ra-white); }
.ra-local-link {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 3px;
}
.ra-local-link__row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.ra-local-link__row .ra-settings__input {
  flex: 1 1 185px;
  min-width: 0;
}

/* ── State card (settings: direct game lookup) ──────────────────── */
.ra-state-card {
  padding: 12px;
  border-radius: 4px;
  background: var(--ra-surface);
  border: 1px solid var(--ra-line);
}
.ra-state-card h4 { margin: 0 0 4px; font-size: 13px; color: var(--ra-white); }
.ra-state-card p { margin: 0; font-size: 12px; color: var(--ra-mute); line-height: 1.5; }

/* ── Buttons ────────────────────────────────────────────────────── */
.ra-btn {
  display: inline-block;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  color: var(--ra-white);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.13s, transform 0.1s;
}
.ra-btn:hover { background: rgba(255, 255, 255, 0.14); }
.ra-btn:active { transform: translateY(1px); }
.ra-btn:disabled { opacity: 0.45; cursor: default; }
.ra-btn--primary {
  background: linear-gradient(180deg, #3a91d4, #1c6fb8);
  border-color: transparent;
  color: var(--ra-white);
  align-self: flex-start;
}
.ra-btn--primary:hover { background: linear-gradient(180deg, #4ba1e4, #2479c4); }

/* ── Spinner ────────────────────────────────────────────────────── */
.ra-spinner {
  width: 26px;
  height: 26px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--ra-blue);
  border-radius: 50%;
  animation: ra-spin 0.7s linear infinite;
  margin: 22px auto;
}
@keyframes ra-spin { to { transform: rotate(360deg); } }

/* ════════════════════════════════════════════════════════════════
   Action-bar stat — sits in the game hero's stat row, next to
   ESTADO DA NUVEM / TEMPO DE JOGO. Mirrors Steam's stat-item look.
   ════════════════════════════════════════════════════════════════ */
.ra-statitem {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 18px;
  box-sizing: border-box;
  font-family: "Motiva Sans", "Segoe UI", system-ui, sans-serif;
}
.ra-statitem * { box-sizing: border-box; }
.ra-statitem__icon {
  display: flex;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.55);
}
.ra-statitem__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ra-statitem__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}
.ra-statitem__value {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}
.ra-statitem__bar {
  margin-top: 3px;
  width: 92px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.ra-statitem__fill {
  height: 100%;
  border-radius: 2px;
  background: #c3ced8;
}

/* ════════════════════════════════════════════════════════════════
   Modal — link/search dialog, portalled to the document body.
   ════════════════════════════════════════════════════════════════ */
.ra-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.74);
  backdrop-filter: blur(2px);
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Motiva Sans", "Segoe UI", system-ui, sans-serif;
  animation: ra-fade 0.16s ease;
}
@keyframes ra-fade { from { opacity: 0; } to { opacity: 1; } }

.ra-modal {
  width: 460px;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  background: linear-gradient(180deg, #2b2f37, #22252b);
  box-shadow: 0 28px 70px -16px rgba(0, 0, 0, 0.85);
  color: var(--ra-text, #c6d4df);
  animation: ra-slide-up 0.22s cubic-bezier(0.2, 0.85, 0.25, 1);
}
.ra-modal--wide {
  width: min(820px, calc(100vw - 32px));
}
.ra-modal--browser {
  width: min(980px, calc(100vw - 32px));
  height: min(760px, calc(100vh - 42px));
  max-height: calc(100vh - 42px);
}
@keyframes ra-slide-up {
  from { opacity: 0; transform: translateY(14px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ra-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.ra-modal__title { font-weight: 700; font-size: 14px; color: #fff; }
.ra-modal__close {
  background: none; border: none;
  color: #8b929b; font-size: 19px; line-height: 1;
  cursor: pointer; padding: 0 4px;
}
.ra-modal__close:hover { color: #fff; }
.ra-modal__tabs { display: flex; border-bottom: 1px solid rgba(255, 255, 255, 0.07); }
.ra-modal__tab {
  flex: 1; padding: 10px;
  background: none; border: none;
  color: #8b929b; font-size: 13px; cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.13s, border-color 0.13s;
}
.ra-modal__tab--active { color: #fff; border-bottom-color: var(--ra-blue, #1a9fff); }
.ra-modal__body {
  flex: 1; overflow-y: auto;
  padding: 13px 16px;
  display: flex; flex-direction: column; gap: 9px;
  min-width: 0;
  box-sizing: border-box;
}
.ra-modal__input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 8px 11px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  color: #fff; font-size: 13px;
}
.ra-modal__input:focus { outline: none; border-color: var(--ra-blue, #1a9fff); }
.ra-modal__select {
  width: 100%;
  padding: 8px 11px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.ra-modal__select:focus { outline: none; border-color: var(--ra-blue, #1a9fff); }
.ra-modal__select option { background: #22252b; color: #fff; }
.ra-console-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(142px, 1fr));
  gap: 14px 16px;
  min-width: 0;
  box-sizing: border-box;
  max-height: 310px;
  overflow-y: auto;
  padding: 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.ra-console-picker__group {
  min-width: 0;
}
.ra-console-picker__title {
  margin: 0 0 6px;
  color: var(--ra-blue-light, #67c1f5);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}
.ra-console-picker__item {
  width: 100%;
  min-height: 25px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--ra-text, #c6d4df);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
}
.ra-console-picker__icon {
  width: 22px;
  min-width: 22px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #d7e5ef;
  font-size: 8px;
  font-weight: 800;
  line-height: 1;
}
.ra-console-picker__item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(103, 193, 245, 0.28);
  color: #fff;
}
.ra-console-picker__item--active {
  background: rgba(26, 159, 255, 0.16);
  border-color: rgba(103, 193, 245, 0.58);
  color: #fff;
}
.ra-console-picker__selected,
.ra-console-picker__empty {
  font-size: 12px;
  color: var(--ra-mute, #8b929b);
}
.ra-modal__result-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border-radius: 4px; cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;
}
.ra-modal__result-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(26, 159, 255, 0.4);
}
.ra-modal__result-icon { width: 42px; height: 42px; border-radius: 3px; flex-shrink: 0; image-rendering: pixelated; }
.ra-modal__result-title { font-size: 13px; color: #fff; }
.ra-modal__result-console { font-size: 11px; color: #8b929b; }
.ra-modal__diag {
  font-family: ui-monospace, "Consolas", monospace;
  font-size: 10.5px;
  line-height: 1.5;
  color: #8f9aa6;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 4px;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ra-modal__footer {
  padding: 11px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  box-sizing: border-box;
  display: flex; justify-content: flex-end; gap: 8px;
}
.ra-popup-frame {
  width: 100%;
  min-height: 0;
  flex: 1;
  border: 0;
  background: #111;
}
.ra-local-ach-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ra-local-ach-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 2px;
}
.ra-local-ach-toolbar__label {
  color: var(--ra-mute, #8b929b);
  font-size: 12px;
}
.ra-local-ach-toolbar__select {
  min-width: 132px;
  padding: 6px 9px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-family: inherit;
  font-size: 12px;
}
.ra-local-ach-toolbar__select:focus {
  outline: none;
  border-color: var(--ra-blue, #1a9fff);
}
.ra-local-ach-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

/* ════════════════════════════════════════════════════════════════
   Settings page
   ════════════════════════════════════════════════════════════════ */
.ra-local-ach-list__meta {
  min-width: 0;
}
.ra-local-ach-list__description {
  margin-top: 2px;
  margin-bottom: 3px;
  color: var(--ra-text, #c6d4df);
  font-size: 12px;
  line-height: 1.35;
}

.ra-settings {
  padding: 18px;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-family: "Motiva Sans", "Segoe UI", system-ui, sans-serif;
  color: #c6d4df;
}
.ra-settings__section {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 15px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.ra-settings__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ra-blue-light, #67c1f5);
}
.ra-settings__input {
  padding: 9px 11px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  color: #fff;
  font-size: 13px;
}
.ra-settings__input:focus { outline: none; border-color: var(--ra-blue, #1a9fff); }
.ra-settings__status { font-size: 12px; padding: 2px 0; }
.ra-settings__status--ok { color: #6fd36f; }
.ra-settings__status--error { color: #e8615f; }
.ra-settings__hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ra-mute, #8b929b);
}
.ra-dismissed-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ra-dismissed-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: var(--ra-text, #c6d4df);
}
.ra-dismissed-list__item span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ra-dismissed-list__item strong {
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ra-dismissed-list__item small {
  color: var(--ra-mute, #8b929b);
  font-size: 10.5px;
}
`

/** Inject the plugin stylesheet into `doc` once. Safe to call repeatedly. */
export function ensureStyles(doc: Document | null | undefined): void {
  if (!doc) return
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement("style")
  style.id = STYLE_ID
  style.textContent = PANEL_CSS
  ;(doc.head ?? doc.documentElement)?.appendChild(style)
}
