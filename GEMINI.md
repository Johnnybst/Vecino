# AGENTS.md — Vecino

> This file is for AI coding assistants (Claude, Copilot, Gemini) working in this repo.
> Read the whole thing before you do anything.
> Copy it as `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` so every tool loads it.

---

## 1. How to talk to us (read this first)

We're a team of 4 at a hackathon. Deadline: **Sunday 10:00 AM (Miami time)**. Talk to us like this:

- **Plain words.** No jargon unless you explain it in the same sentence. Say "the list of red circles," not "the hazard FeatureCollection payload."
- **One thing at a time.** Give us one step, wait for us to say it worked, then give the next step.
- **Short.** 3–6 lines of explanation max, then the code or command.
- **Numbered steps** when there's more than one step. Say exactly which file and where.
- **Say what "done" looks like** — what we should see on screen when it works.
- **Be direct.** If our idea won't work, say so and give the simpler option. Don't give us 4 options — pick the best one and say why in one line.
- **No surprise changes.** Before editing, say which files you'll touch in one line. Don't refactor or "clean up" things we didn't ask about.
- If we seem stuck or going in circles for a while, remind us of the 20-minute rule (section 9).

First thing to ask if we haven't said: **"Which person are you — 1, 2, 3 or 4?"** Then stay inside that person's job (section 8).

---

## 2. What we're making

**Vecino.** You type where you are and where you're going. The map shows your normal route and a safer route that goes around places where people reported ICE activity recently. One short sentence explains the detour, in English, Spanish or Haitian Creole.

How the pieces connect:

```
Person 1: Alerts      →  GET /hazards   (list of red circles)
Person 2: Routes      →  POST /route    (normal route + safe route)
Person 3: Map app     →  the screen people see (calls both of the above)
Person 4: AI sentence →  explain() used inside /route  + pitch + bonus layer
```

Contest tracks we're entering, and what that means for the code:

| Track | What the code must do |
|---|---|
| Waymo (main) | Real routes on a real Google map |
| Gemini | Gemini does real work (the explanation sentence; optionally locating reports) |
| Microsoft | **No chat box or chat window anywhere.** The AI works in the background |
| State Farm (bonus) | Road-risk layer (car theft + crashes). Only built if check-in 3 passes |

---

## 3. The schedule (so you know how much time is left)

| Time | What happens |
|---|---|
| Sat 12:30 PM | **Check-in 1:** each piece works alone, on fake data |
| Sat 5:00 PM | **Check-in 2 (the big one):** two addresses in → route goes around a red circle. Everyone merges |
| Sat 9:00 PM | **Check-in 3:** app is online at a real link, AI sentence works, Spanish works. Decide on bonus layer |
| Sun 1:00 AM | **Check-in 4:** no new features after this — only fixes |
| Sun 7:00 AM | **Check-in 5:** record backup demo video |
| Sun 9:30 AM | **Submit** |

**Your job with the clock:**
- If it's after 1:00 AM Sunday and we ask for a new feature, remind us of the rule and suggest a fix or polish task instead.
- If a task is taking much longer than its estimate, say so and offer the fastest shortcut (usually: use fake data).

---

## 4. Rules that never change

1. **Privacy.** No user accounts. Never save, log or send someone's start/end location anywhere except the one route request. No analytics.
2. **Fake-data mode.** Everything must work with `DEMO_MODE=true`, reading `data/seed_reports.json`. The demo can't depend on real alerts happening.
3. **No chat UI.** Ever.
4. **Calm words in the app.** Say "reported activity," "avoids 2 reports." Never "danger," "raid," "run."
5. **Circles fade.** `weight = confidence * exp(-age_minutes / 90)`. Hide circles with `weight < 0.1`.
6. **Keys stay secret.** API keys only in `.env`. Never in code, commits, logs or chat.
7. **Simple wins.** Smallest change that works. No new frameworks.

---

## 5. What's in the repo

This repo is a fork of [a-banoub/ICE](https://github.com/a-banoub/ICE), a Python program that already collects ICE reports. **Reuse it. Don't rewrite it.**

```
collectors/            ALREADY THERE  Collects reports (IceOut, StopICE, Bluesky, RSS, ...)
  iceout_collector.py                 Uses a hidden Chrome browser to read IceOut's feed.
                                      IceOut reports already have map coordinates.
                                      Most likely thing to break — don't sink hours into it.
processing/            ALREADY THERE  Filters reports; finds locations in text (weak for Miami)
correlation/           ALREADY THERE  Groups nearby reports into one "cluster" with a
                                      confidence score. Clusters = our red circles.
storage/database.py    ALREADY THERE  SQLite file ice_monitor.db. Tables: raw_reports, clusters
notifications/         ALREADY THERE  Discord alerts — we don't use it (DRY_RUN=true)
locales/miami.yaml     ALREADY THERE  Miami settings: center 25.7617,-80.1918, 60 km radius
main.py                ALREADY THERE  Runs the collector:  uv run python main.py --dry-run

api/                   WE BUILD       FastAPI server: /hazards, /route, explain()
frontend/              WE BUILD       React + Vite + Google Maps
data/                  WE BUILD       seed_reports.json, demo_route.json, risk/
```

Delete if you see them: `main - Copy.py`, `run_bot - Copy.py`.

The `clusters` table (read it, don't change it):
```sql
clusters(id, primary_location, latitude, longitude, confidence_score, source_count,
         unique_source_types, earliest_report, latest_report, notified, notified_at, city, created_at)
```
Things to know:
- Times are text in ISO format, UTC.
- **Don't use `db.get_active_clusters()`** — it only returns clusters that were sent to Discord. Query `clusters` directly: `latest_report` within the last 6 hours, `latitude IS NOT NULL`.
- The repo deletes clusters after 6 hours. That's fine.

---

## 6. The shared format (all 4 people depend on this — don't change it without the team)

### `GET /hazards` — the red circles
Optional `?at=<ISO time>` to pretend it's a different time (for the fade slider).

Returns GeoJSON. Each cluster becomes a circle about **300 m wide** (16–24 points). Coordinates are **[longitude, latitude]** and the first point repeats at the end.

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [[[-80.2105,25.7825],[-80.2065,25.7825],[-80.2065,25.7855],[-80.2105,25.7855],[-80.2105,25.7825]]] },
    "properties": {
      "id": "hz_12",
      "summary": "2 reports near NW 7th St & 27th Ave",
      "reported_at": "2026-09-26T14:20:00Z",
      "confidence": 0.8,
      "report_count": 2,
      "weight": 0.64
    }
  }]
}
```
From the `clusters` table: `id` → `"hz_" + id`, `primary_location` → `summary` (add `"{source_count} reports near "` in front), `latest_report` → `reported_at`, `confidence_score` → `confidence`, `source_count` → `report_count`.

### `POST /route` — the two routes
Send:
```json
{ "origin": {"lat": 25.757, "lng": -80.374}, "destination": {"lat": 25.766, "lng": -80.219}, "profile": "driving-car" }
```
`profile` is `driving-car`, `foot-walking` or `cycling-regular`.

Get back:
```json
{
  "safe":   { "geometry": {"type":"LineString","coordinates":[...]}, "duration_s": 1260, "distance_m": 8400, "hazards_avoided": ["hz_12"] },
  "normal": { "geometry": {"type":"LineString","coordinates":[...]}, "duration_s": 900,  "distance_m": 7100, "hazards_crossed": ["hz_12"] },
  "extra_minutes": 6,
  "explanation": { "en": "...", "es": "...", "ht": "..." },
  "left_out": ["hz_7"]
}
```
If the normal route doesn't touch any circle, `safe` is the same as `normal`, and the sentence says the usual way looks clear.
`left_out` = circles skipped because they cover the start or end point.

---

## 7. Setup

`.env` (never commit this file):
```
LOCALE=miami
DRY_RUN=true
TWITTER_ENABLED=false
INSTAGRAM_ENABLED=false
DB_PATH=ice_monitor.db
DEMO_MODE=true
GEMINI_API_KEY=
GEMINI_MODEL=            # use a current Gemini Flash model
ORS_API_KEY=
VITE_GOOGLE_MAPS_KEY=
VITE_API_URL=http://localhost:8000
```

Run it (3 terminals):
```bash
# one-time
uv sync
uv add fastapi uvicorn httpx google-genai
uv run playwright install chromium
uv run python -m spacy download en_core_web_sm

uv run python main.py --dry-run                     # 1: collector (Person 1 only needs this)
uv run uvicorn api.main:app --reload --port 8000    # 2: our server
cd frontend && npm install && npm run dev           # 3: the map app
```
The server must allow the frontend to call it (turn on CORS for `http://localhost:5173` and the live frontend link).

---

## 8. Each person's job

Work top to bottom. Each box has a **"Done when"** — show the human how to check it.

### Person 1 — the alerts
Files: `api/hazards.py`, `api/main.py`, `data/`

1. **Get the ICE repo running for Miami** (section 7). ~45 min.
   **Hard stop at 10:30 AM Saturday:** if it isn't collecting Miami reports, tell them to move on to step 2. Don't keep debugging the collector.
2. **Fake-data file** `data/seed_reports.json`: 10–15 realistic Miami reports (Little Havana, Hialeah, Doral, Allapattah, Little Haiti, Sweetwater, near FIU). Mark each `"synthetic": true`. When loading, shift the times so the newest one is 10 minutes ago.
3. **`GET /hazards`** (section 6). In `DEMO_MODE` read the fake file; otherwise read `clusters` from SQLite in read-only mode. Make circles with simple math, no extra libraries: move `r / 111320` degrees in latitude and `r / (111320 * cos(lat))` in longitude.
   **Done when:** `localhost:8000/hazards` shows the circles, and pasting the output into geojson.io shows them in the right Miami spots. *(Check-in 1)*
4. Circles fade (rule 5) and `?at=` works.
5. After check-in 2: put the server online (Render or Railway). Then help whoever is behind.
6. Optional, only if ahead: when a Bluesky/RSS report has no coordinates, ask Gemini for `{lat, lng, place_name, confidence}` (use a response schema). Throw away answers more than 60 km from Miami's center.

### Person 2 — the routes
Files: `api/routing.py`, `api/main.py`

1. **Get one route.** `POST https://api.openrouteservice.org/v2/directions/{profile}/geojson`, header `Authorization: <ORS_API_KEY>`, body `{"coordinates": [[lng,lat],[lng,lat]]}`. Use `httpx.AsyncClient`. Test: FIU → Little Havana. ~30 min.
2. **Go around one fake circle.** Same call plus `"options": {"avoid_polygons": <MultiPolygon>}`.
   **Done when:** both routes pasted into geojson.io, and the second one clearly goes around the circle. *(Check-in 1)*
3. **`POST /route`** (section 6). Get the circles by calling Person 1's function directly (not over the web). Only use circles with `weight ≥ 0.1`.
4. **Leave out circles that cover the start or end** (otherwise the route service errors) and list them in `left_out`. If the route service still refuses, retry with only the 10 strongest circles.
5. **Which circles does a route cross?** Check points every ~25 m along the line against each circle.
   **Done when:** the map app can show both routes from real data. *(Check-in 2)*
6. Save one good response as `data/demo_route.json`, and use it if the route service is down.
7. Plug in Person 4's `explain()`. Until it's ready, use a plain sentence.

### Person 3 — the map app
Files: `frontend/`. React + Vite + TypeScript + `@vis.gl/react-google-maps`. Must look good on a phone (390 px wide).

1. **Map of Miami** full screen. Google key needs "Maps JavaScript API" + "Places API". ~1 hour with setup.
2. **"From" and "To" boxes** with address suggestions (Places Autocomplete). Plus a "use my location" button: the location is used only for the route request, never saved. Also a drive / walk / bike switch.
3. **Draw fake data** typed into the code (copy section 6): red circles, green safe route (solid line), gray normal route (dashed line).
   **Done when:** all of that shows on the map, even though it's fake. *(Check-in 1)*
4. **Switch to real data.** Load `/hazards` every 60 seconds. Circle color is muted red, `fillOpacity = 0.15 + 0.45 * weight`.
5. **Bottom card:** "+6 min · avoids 2 reports" with the explanation sentence under it.
6. **Tap a circle** to get a small popup: summary, "reported 20 min ago," confidence shown as Low / Medium / High.
   **Done when:** two real addresses in → both routes and the card show up. *(Check-in 2)*
7. After check-in 2: put the app online (Vercel). English / Español / Kreyòl switch, with all text in one `i18n.ts` file. Time slider (demo only) that sends `?at=` to `/hazards` so circles fade.
8. **Never add a chat box, chat bubble or "Ask AI" button.**

### Person 4 — the AI sentence, the pitch, and the bonus layer
Files: `api/explain.py`, `data/risk/`

1. **`explain(extra_minutes, hazards_avoided, lang)`** in `api/explain.py`. One Gemini call that returns JSON `{en, es, ht}` using a response schema. Tell Gemini: 25 words max, calm, factual, mention the extra minutes and how many reports were avoided, don't guess about anything not in the summaries.
2. **Backup:** if Gemini takes more than 4 seconds or fails, return a plain template sentence. Save answers so the same trip doesn't call Gemini twice.
   **Done when:** 3 made-up trips each give 3 good sentences, and turning off wifi gives the backup sentence. *(Check-in 1)*
3. **Bonus layer data prep (State Farm).** Download Miami-Dade crime/car-theft data and Florida crash data as CSV. Turn them into a grid of ~250 m squares, each with `score` from 0 to 1 → `data/risk/risk_grid.geojson`. **Stop there. Don't connect it yet.**
4. After check-in 2: help Person 2 plug in `explain()`. Help with the slides (5 max: problem, demo, how it works, privacy, tracks).
5. **Only if check-in 3 passes:** add `GET /risk` and a `risk_score` on each route (average score of the squares the route crosses). This is **adding** a field only; nothing else in the format changes. Then add a "Show road risk" switch on the map.
6. Sunday morning: help write the Devpost.

---

## 9. When someone is stuck

1. Ask for the exact error message and the file. Fix it with one clear change.
2. If it's still broken after about **20 minutes**, tell them to post "stuck on ___" in the team chat. That's the team rule, not failing.
3. Offer the shortcut: swap in fake data or skip the step and come back later.

## 10. Before saying something is finished

- It works with `DEMO_MODE=true`.
- No API keys in the change. No user locations logged.
- The shared format (section 6) is unchanged, or only has fields added with the team's OK.
- You told the human the 1–2 commands to test it, and what they should see.
