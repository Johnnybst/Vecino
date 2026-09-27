# Vecino frontend

From `frontend/`, install and start the app:

```powershell
npm.cmd install
npm.cmd run dev
```

Create `frontend/.env` using `.env.example` as the template. Enter the Google Maps browser key locally; never commit `.env`.

- `VITE_GOOGLE_MAPS_KEY`: the Google Maps browser key.
- `VITE_API_URL`: the server address, with no `/hazards` or `/route` suffix.
- `VITE_DEMO_MODE`: must match the server's `DEMO_MODE` setting.

## Demo and live reports

For the hackathon demo, use `DEMO_MODE=true` in the server's root `.env` and `VITE_DEMO_MODE=true` in `frontend/.env`. The map labels the reports as synthetic and offers the time slider. The slider calls `/hazards?at=<UTC time>`; it does not calculate routes for the simulated time.

For collected reports, Person 1 must first provide a working collector database and configure the server with `DEMO_MODE=false` and its `DB_PATH`. Then set `VITE_DEMO_MODE=false` in the frontend. This removes synthetic labels from server reports and hides the time slider. The separate sample-route screen remains explicitly marked as demo data.

Changing the frontend flag does not change the server's data source. An empty live feed means no reports were returned, not a guarantee that an area is clear. Restart local services after changing their settings. Vercel environment changes require a new deployment.

## Checks

```powershell
npm.cmd run build
npm.cmd run lint
```

At 390 x 844, check English, Spanish and Haitian Creole controls, route cards, circle popups and the demo time slider. Switching languages uses the existing server explanation and does not send another route request.

The demo slider sits above the route card on the main map. It previews report fading without recalculating routes; starting or editing a trip resets it to now. Report polygons use the server's geometry so their sizes match routing. Severity colors turn gray with age, and circles below weight 0.1 disappear.

Traffic and Road incidents are off by default. Road incidents load from `/incidents` every five minutes while enabled; their icons do not change routes. Missing or empty incident data does not mean roads are clear. All interface labels have English, Spanish and Haitian Creole versions; incoming incident descriptions stay as provided by the source.

Address suggestions are restricted to the agreed Miami-Dade box. Out-of-area trips show a translated message. Route cards show km and mi, and use `has_detour` to choose between Detour and Usual route (with a geometry comparison for older servers). Start and destination have pin/flag symbols. Map and card animations last under 300 ms and are disabled for reduced motion.

## Hosting handoff

For Vercel, use `frontend` as the root directory, the Vite preset, `npm run build`, and output directory `dist`. Set the three frontend environment variables there; `VITE_API_URL` must be the hosted HTTPS server address, not localhost. Person 1 must allow the frontend domain in the server's CORS settings. ORS and Gemini keys belong only on the server, never in `VITE_` variables.
