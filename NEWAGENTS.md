# NEWAGENTS.md — Vecino, round 2

> For AI coding assistants. **Read `AGENTS.md` first** — its rules (section 4), talking style (section 1)
> and shared format (section 6) still apply. This file only adds the new jobs and the new fields.
> Tell your AI: "read AGENTS.md and NEWAGENTS.md, I'm Person _".

---

## 1. Where we are

Working on `main` today: fake reports → `/hazards` → `/route` (normal + safe route, Gemini sentence,
start/destination warning) → map app with circles, both routes, bottom card, popups, 3 languages.

**Not started:** the app online (server + map), the State Farm road-risk layer.

## 2. Order of work

1. **Put it online first** (Person 1 server, Person 3 map). After that, every merge to `main` updates the live app.
2. **Small fixes** (section 5, "Before check-in 2").
3. **Medium features** (by check-in 3, 9 PM).
4. **Bonus** (road risk, follow-me, live incidents) only if check-in 3 passes. **Nothing new after 1 AM.**

If a box takes twice its estimate, stop and use the shortcut listed under it.

---

## 3. New shared fields (add only — nothing in AGENTS.md section 6 changes)

### `GET /hazards` — two new properties on each circle
```json
"properties": { "...everything from before...", "severity": "high", "radius_m": 100 }
```
| `severity` | When | `radius_m` | Base color |
|---|---|---|---|
| `"low"` | 1 report | 75 | amber `#D4A017` |
| `"medium"` | 2–3 reports | 90 | orange `#E0702A` |
| `"high"` | 4+ reports, or confidence ≥ 0.85 | 100 | red `#D0342C` |

Circles are about 1–2 blocks across (150–200 m). The circle drawn by `/hazards` uses `radius_m`. Routing must use the same `radius_m` for each circle.

### `POST /route` — new fields
```json
{
  "has_detour": true,
  "safe":   { "...": "...", "risk_score": 0.42 },
  "normal": { "...": "...", "risk_score": 0.61 }
}
```
- `has_detour`: `true` only when the safe route is actually different from the normal one.
- `risk_score`: 0–1, or `null` until the road-risk layer exists (Person 4, bonus).

### `GET /incidents` — live crashes and closures (built, Person 4)
Points only, **shown on the map but never avoided by routes** (they clear too fast). Refreshes at most every 5 min.
```json
{ "type": "FeatureCollection",
  "features": [{ "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [-80.1857, 25.7868] },
    "properties": { "id": "fhp_1", "type": "crash", "description": "Vehicle Crash · I-395 EB x[BISCAYNE BLVD] [MIAMI]",
                    "started_at": "2026-09-27T16:04:13Z", "delay_s": null, "source": "fhp" } }],
  "properties": { "sources": ["tomtom", "fhp"], "updated_at": "..." } }
```
`type` is `crash`, `stalled_vehicle`, `road_closed` or `lane_closed`. Sources: TomTom (needs `TOMTOM_API_KEY`, city streets + highways)
and Florida Highway Patrol (no key, highways). An empty list means nothing was found, not that roads are clear.
**Person 3:** a small icon per `type`, popup with `description` and "started X min ago". Load every 5 min.

### `GET /risk` (bonus, Person 4)
Returns `data/risk/risk_grid.geojson` — squares with `properties.score` from 0 to 1.

---

## 4. Rules for this round

1. **Color = how serious. Grayness = how old.** A new report is its full color. As it ages over
   **3 hours** it blends toward gray: `mix(base, #9E9E9E, min(age_minutes / 180, 1) * 0.75)`.
   Circles still hide at `weight < 0.1` (AGENTS.md rule 5) — don't change the fade rule.
2. **Distances in both units:** `12.4 km · 7.7 mi` (1 mi = 1.609 km). Minutes stay minutes.
3. **"Detour" only when `has_detour` is true.** Otherwise the card says "Usual route" and the gray line is hidden.
4. **Location stays on the phone.** Follow-me mode never sends location anywhere except a route request the person taps.
5. **Animations are CSS only**, under 300 ms, and turned off for `prefers-reduced-motion`. No animation libraries.
6. **Calm words** still apply to every new label, icon and warning.
7. **Who owns which file** (to avoid merge fights):
   - `frontend/src/App.tsx`, `i18n.ts`, `App.css` → **Person 3**. Others build in their own new file and ask Person 3 to plug it in.
   - `api/hazards.py` → Person 1. `api/routing.py` → Person 2. `api/explain.py`, `api/risk.py` → Person 4.
   - `api/main.py` → whoever needs it, one small change at a time, merge the same hour.
8. **Merge to `main` every time a box is done**, not at the end. Pull `main` before starting each box.

---

## 4b. Miami-Dade only

Everything stays inside one shared box. Use these exact numbers everywhere:

```
south 25.13   north 25.98   west -80.88   east -80.11
```

| Who | File | What to do |
|---|---|---|
| Person 1 | `api/hazards.py` | Drop reports whose center is outside the box (real reports only; the fake ones are already inside). |
| Person 2 | `api/routing.py` / `api/main.py` | If the start or end is outside the box, don't call the route service. Return HTTP 422 with `"detail": "outside_area"`. |
| Person 3 | `frontend/src/App.tsx`, `i18n.ts` | Address boxes: use `locationRestriction` with the box instead of `locationBias`, so only Miami-Dade places are suggested. When `/route` says `outside_area`, show "Vecino covers Miami-Dade only" in all 3 languages. |
| Person 4 | `scripts/build_risk_grid.py`, `api/incidents.py` | Risk grid already uses the box. Live incidents: Miami-Dade only. |

**Done when:** typing "Orlando" in From shows no suggestions, and a `/route` request with a start in Fort Lauderdale returns 422.

---

## 5. Each person's job

### Person 1 — alerts + server online
Files: `api/hazards.py`, `api/main.py`, hosting

**Now**
1. **Server online** (Render or Railway). Start command `uv run uvicorn api.main:app --host 0.0.0.0 --port $PORT`.
   Set all `.env` values as the host's environment variables. ~1 hour.
   **Done when:** `https://<your-server>/hazards` shows circles in the browser.
2. **CORS from a setting:** read allowed links from `ALLOWED_ORIGINS` (comma-separated) instead of the fixed list, so Person 3's Vercel link can be added without a code change.
3. Tell the team the server link. Keep `DEMO_MODE=true` online for now.

**Before check-in 2**
4. **`severity` and `radius_m`** on each circle (section 3). Draw the circle with `radius_m`.
   **Done when:** `/hazards` shows all three severities in the fake data (edit `seed_reports.json` so each appears).

**By check-in 3**
5. **Collector online?** Try running `main.py` on the host. If it isn't collecting Miami reports within **45 min**, stop — the demo stays on fake data.

**Bonus, only if ahead**
6. ~~Live road incidents~~ **Done by Person 4** (`api/incidents.py`, `GET /incidents`). Only job left for you: add
   `TOMTOM_API_KEY` to the online server's settings.

### Person 2 — routes + follow-me
Files: `api/routing.py`, `frontend/src/useFollowMe.ts` (new)

**Before check-in 2**
1. **Use each circle's `radius_m`** when avoiding and when checking which circles a route crosses (keep the extra 300 m gap on top).
2. **`has_detour`** in the `/route` answer (section 3).
3. Save a new `data/demo_route.json` once both are in.
   **Done when:** the tests pass (`uv run pytest tests -q`) and `/route` shows `has_detour`.

**By check-in 3**
4. **Help Person 3** plug in `has_detour` and the km/mi text on the card.

**Bonus, only if check-in 3 passes: follow-me mode** (not full turn-by-turn)
5. In a new file `useFollowMe.ts`: a React hook that uses `navigator.geolocation.watchPosition`, and returns the
   current spot and whether the person is **more than 50 m off the green route for 3 readings in a row**.
6. The map shows a blue dot, keeps it centered, and shows a **"Recalculate"** button when off route.
   Tapping it sends one new `/route` request. **No automatic rerouting, no voice.**
   **Shortcut:** blue dot only, no off-route check.

### Person 3 — the map app + map online
Files: `frontend/`

**Now**
1. **Map online (Vercel).** Root `frontend`, preset Vite. Set `VITE_API_URL` to Person 1's server link. Send your Vercel link to Person 1 for `ALLOWED_ORIGINS`.
   **Done when:** the Vercel link on a phone shows the map with circles.

**Before check-in 2**
2. **km and miles** on the card (rule 2).
3. **"Detour" only when there is one** (rule 3), using `has_detour`.
4. **Slider back on the main screen** — a small bar above the bottom card, demo mode only.

**By check-in 3**
5. **Circle size and color by severity, graying by age** (section 3 + rule 1). Fill opacity stays `0.15 + 0.45 * weight`.
   Add the three colors to the legend.
   **Done when:** a fresh high report is bright red and big; a 2-hour-old one is grayish.
6. **Traffic switch:** a "Traffic" toggle that turns on Google's built-in traffic layer. Off by default.

**Polish (after check-in 3, stop at 1 AM)**
7. Small symbols: a pin for start, a flag for destination, a small icon per severity in popups and the legend.
8. Animations (rule 5): the bottom card slides up, new circles fade in, the route draws in.
9. Check everything at 390 px wide in all 3 languages.

### Person 4 — AI sentence, road risk (State Farm), pitch
Files: `api/explain.py`, `api/risk.py` (new), `data/risk/`, `scripts/build_risk_grid.py` (new), slides

**Before check-in 2**
1. **`explain()` update:** accept `has_detour` and distance; only mention a detour when there is one. Give the distance in km **and** mi.
2. **Road-risk data** (from AGENTS.md — not done yet). Download Miami-Dade car-theft/crime CSV and Florida crash CSV
   (Miami-Dade only, last 1–2 years). ~1.5 hours.
   **Shortcut:** if one dataset fights you for 30 min, use just the other one.
3. **`scripts/build_risk_grid.py`:** make ~250 m squares over Miami, count incidents in each, turn counts into a
   `score` from 0 to 1 (divide by the 95th-percentile count, cap at 1). Save `data/risk/risk_grid.geojson`.
   **Done when:** pasting the file into geojson.io shows darker squares on busy roads and hotspots.

**After check-in 2**
4. Slides (5 max): problem, demo, how it works, privacy, tracks.

**Only if check-in 3 passes**
5. **`GET /risk`** in `api/risk.py`, and a function `route_risk(line)` = average score of the squares the route passes through.
   Ask Person 2 to call it for `risk_score` on both routes.
6. A **"Road risk" switch** component in a new file `frontend/src/RiskLayer.tsx` (squares from light to dark). Ask Person 3 to plug it in.
7. Sunday morning: Devpost + pitch practice.

---

## 6. Check-ins for this round

| Check-in | What must work |
|---|---|
| **2** (5:00 PM) | Server + map online at real links. `severity`/`radius_m`, `has_detour`, km + mi in `main`. Risk grid file exists. |
| **3** (9:00 PM) | Severity colors + graying on the live link. Slider on the main screen. Traffic switch. Spanish works. **Decide on bonus** (road risk, follow-me, incidents). |
| **4** (1:00 AM) | Freeze. Only fixes after this. |

## 7. Before saying something is finished

Everything in AGENTS.md section 10, plus:
- It works on the **live link**, not just localhost.
- It works at 390 px wide.
- New text exists in all 3 languages in `i18n.ts`.
