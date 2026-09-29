# HeatKshetra

HeatKshetra is a Smart India Hackathon prototype for ward-level heat-health risk in Mumbai. The React/Leaflet dashboard, FastAPI service, and SQLite database run as one local application. On startup, the API imports the 24 ward boundaries, calculates population estimates from the checked-in census data, and fetches live current conditions and a five-day forecast from Open-Meteo.

## Data and model status

- Weather comes from Open-Meteo and refreshes every 30 minutes by default. The current temperature is a gridded weather-model estimate for each ward centroid, not a local sensor reading. If weather is unavailable, the dashboard shows an unavailable message rather than substituting invented readings.
- The source GeoJSON is `app/data/MUMBAI.geojson`, downloaded from [datta07/INDIAN-SHAPEFILES](https://github.com/datta07/INDIAN-SHAPEFILES). It provides 24 canonical Mumbai ward polygons. The source repository describes its data as primarily from 2019; verify boundaries against current MCGM data before operational use.
- `app/data/wards_demographics.csv` currently contains eight generic example profiles. The importer maps them in listed order to the first eight canonical wards and uses the CSV column medians as placeholder values for the remaining wards. All records are marked as placeholders; these are not official ward-level demographics and must not be presented as such.
- `app/data/ward_population_census.csv` contains the ward census population input; `app/data/greater_mumbai_census_totals.csv` contains the city totals used to calculate CAGR. The app derives the annual rate from the latest two census years available, then projects each ward's latest available census population to the current year. Current bundled ward figures are labelled low or medium confidence estimates.
- Formula: `CAGR = (latest city census population / previous city census population)^(1 / years between censuses) - 1`. With the bundled totals (11,978,450 in 2001; 12,442,373 in 2011), the annual rate is 0.3807%. Ward projection is `ward census population * (1 + CAGR)^(target year - ward census year)`, rounded to a whole person.
- When official 2027 Census ward populations are published, add one row per ward with `census_year=2027`, the official count, and `confidence=official`. Add the official Greater Mumbai total for 2027 to the city totals CSV. The running API re-reads these CSVs on its scheduled refresh (every 30 minutes by default); restarting the API also applies them. Matching official ward counts are used directly, while wards without an official row remain projected and are labelled as such.
- The illustrative excess-death estimate uses a 7-per-1,000 annual crude-death-rate proxy and the project's heat-risk index. It is not an observed death count or a validated mortality forecast.
- The MRI curve and vulnerability formula are deterministic demonstration assumptions, not a trained model or clinically validated mortality probabilities. The 0–100 map score is a visual mapping of MRI bands, not a probability.
- Simplified WBGT is only an estimate from limited weather inputs; it is not measured WBGT and does not use measured globe temperature.
- Consent-based SMS/WhatsApp alerts can be sent through Twilio from the dashboard. Live delivery requires server credentials and an authenticated administrator action.

## Start HeatKshetra on Windows

Run the backend and frontend in **two separate PowerShell windows**. In both windows, first go to the project folder. If you saved it on your Desktop as `sih2026`, run:

```powershell
cd "$HOME\Desktop\sih2026"
```

Do not run the project commands from `C:\Users\Vidula` or from the frontend folder unless a step below says to. The backend commands need to run from the project root so Python can find `app` and the database stays in the right folder.

### PowerShell window 1: backend and database

On the **first launch**, create the Python environment and install the backend dependencies:

```powershell
cd "$HOME\Desktop\sih2026"
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uvicorn app.main:app --reload
```

Leave this window open while using the app. On later launches, the environment and dependencies are already set up, so start the backend with:

```powershell
cd "$HOME\Desktop\sih2026"
.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

The API creates `heatkshetra.db` in the repository root, imports the 24 ward polygons, updates population estimates, and fetches live weather. Check the API at <http://127.0.0.1:8000/docs> or its health at <http://127.0.0.1:8000/health>.

### PowerShell window 2: frontend

Install [Bun](https://bun.sh/) if it is not already installed. On the **first launch**, install the frontend packages and start Vite:

```powershell
cd "$HOME\Desktop\sih2026\HeatKshetra-main\Downloads\heat-aware-heartland-main\heat-aware-heartland-main"
bun install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
bun run dev
```

Leave this window open too. On later launches, run:

```powershell
cd "$HOME\Desktop\sih2026\HeatKshetra-main\Downloads\heat-aware-heartland-main\heat-aware-heartland-main"
bun run dev
```

Open <http://127.0.0.1:8080> in your browser. If Vite prints a different port, open the URL it prints. The frontend defaults to the backend at `http://127.0.0.1:8000`; its `.env` already uses that address. To stop either server, focus its PowerShell window and press **Ctrl+C**.

If PowerShell blocks virtual-environment activation, run the backend without activating it:

```powershell
cd "$HOME\Desktop\sih2026"
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

To seed or refresh the database without starting the API:

```powershell
python scripts/seed_wards.py
```

To apply updated census CSVs immediately without waiting for the scheduled refresh:

```powershell
.venv\Scripts\python.exe scripts\update_population.py
```

## Push changes to GitHub

The project is connected to `origin` on the `main` branch. From the repository root, review the changed files and push your commit:

```powershell
cd "$HOME\Desktop\sih2026"
git status
git add -A
git commit -m "Update live HeatKshetra dashboard"
git push origin main
```

The root `.gitignore` excludes `.env`, virtual environments, local SQLite databases, and frontend build artifacts. Commit `.env.example` templates, never `.env` files or provider credentials.

## Frontend and API connection map

| Frontend feature | Backend endpoint / service |
| --- | --- |
| Ward heat map and day selector | `GET /wards/geojson?day=0..4` |
| Five-day city forecast and highest-risk wards | `GET /forecast/city?days=5` |
| Ward list for alert subscriptions | `GET /wards` |
| Risk advisory and public action list | `GET /advisories/{risk_level}` and `GET /action-plan/{risk_level}` |
| Ward MRI calculation | `GET /ward/{ward_id}/mri` |
| Alert consent subscription | `POST /subscribe` |
| Live Twilio alerts and recent activity | `POST /alerts/trigger` and `GET /alerts/log` |
| One-browser Firebase push subscription and extreme-risk demo | `POST /push/subscribe` and `POST /alerts/demo-push` |

The backend also exposes operational or alternate data views that are not separate dashboard screens: `GET /health`, `GET /city/mri`, `GET /forecast?ward_id=...`, and `GET /weather/{ward_id}`. `GET /wards` is used to populate the subscription form, rather than shown as its own screen.

The UI controls that intentionally have no backend route are map zoom/layers, browser geolocation, location search (OpenStreetMap Nominatim), and the static explanatory content about heat exposure. The map tiles come directly from OpenStreetMap. These functions do not write or calculate backend data.

## Database and alert configuration

SQLite schema is in `db/schema.sql`; polygon geometry is stored as GeoJSON text, so local setup does not need PostGIS. `DATABASE_URL` can select another SQLite file. On startup, the API migrates older local databases and seeds wards only when its `wards` table is empty. The weather provider is Open-Meteo; review its [forecast API documentation](https://open-meteo.com/en/docs) and [terms](https://open-meteo.com/en/terms) before using the app commercially. Include Open-Meteo attribution as required by its [pricing and attribution terms](https://open-meteo.com/en/pricing).

Configure `ADMIN_API_KEY` and the Twilio account credentials in the root `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `TWILIO_WHATSAPP_FROM` for the channels you use. The dashboard's **Send live heat alerts** action requires that server admin key and sends only to subscribers who explicitly consented, in wards at Orange risk or higher. The browser does not save the key; it is cleared after each send attempt. SMS and WhatsApp delivery are real external messages, so use Twilio test credentials or verified test recipients while configuring. For WhatsApp, configure the approved sender or Twilio sandbox. Do not commit `.env` or put Twilio credentials in the frontend `.env`.

### Configure Firebase push (free prototype notifications)

FCM is Firebase's no-cost browser push service. It sends a notification to an opted-in browser/device; it does **not** send an SMS to a phone number. Localhost is a secure context for service workers. A public HTTPS URL is required when you want to demo on another device or deploy the app.

1. In the [Firebase Console](https://console.firebase.google.com/), create or select a Firebase project and add a **Web app**. Copy its web app settings. In **Project settings → Cloud Messaging → Web configuration**, generate a Web Push key pair and copy the public VAPID key. If the console asks, enable the Firebase Cloud Messaging Registration API for the project.
2. Copy the Firebase web settings into the frontend `.env` beside `package.json` (start from `HeatKshetra-main/Downloads/heat-aware-heartland-main/heat-aware-heartland-main/.env.example`): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_VAPID_KEY`. These browser configuration values and the VAPID public key are public; never put a service-account private key here.
3. In Firebase **Project settings → Service accounts**, create/download a private key JSON. Grant its service account the **Firebase Cloud Messaging API Admin** role if it does not already have permission. Put the JSON somewhere outside this repository. In the root `.env`, set `FIREBASE_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS` to the project ID and absolute path of that JSON. Keep `ADMIN_API_KEY` set as well. The backend uses this private key only to authorize FCM sends.
4. From the repository root, install the server dependency with `.venv\Scripts\python.exe -m pip install -r requirements.txt`. Start or restart the backend and frontend after saving the `.env` values. The frontend environment variables are read at startup, so restart the Vite process after editing them.
5. In Chrome or Edge on the same computer, open `http://127.0.0.1:8080/?risk-preview=extreme#city-actions`. This development-only preview changes the displayed risk to fake extreme data; it does not update the database or trigger city-wide alerts.
6. In **Extreme-risk push demo**, check the consent box and click **Enable push on this browser**. Allow notifications in the browser prompt. This registers only this browser for push against its selected ward.
7. Enter the backend `ADMIN_API_KEY` in **Server admin key**, then click **Send real demo push**. The backend sends one clearly marked demo notification to that browser and records Firebase's acceptance in recent alert activity. Keep the tab open for an in-page message; to verify background push, minimize the browser. The operating system or browser must allow notifications.

For a phone demo, deploy the frontend on HTTPS and open that URL on the phone; localhost on your PC is not reachable as the phone's website. Repeat the opt-in there and send to that browser's registration. Firebase acceptance confirms that FCM accepted the message for delivery, not that a person saw it. Browser notification controls, device state, and network can still prevent display. The preview is fake, but the push is real and explicitly marked as a test. This demo panel is only shown in a development build.

Firebase references: [web client setup and token registration](https://firebase.google.com/docs/cloud-messaging/web/get-started), [receiving web messages](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), [sending from a trusted server](https://firebase.google.com/docs/cloud-messaging/send/v1-api), and [Firebase pricing](https://firebase.google.com/pricing).

### Record a real Twilio SMS in the prototype video

1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in the root `.env`, along with `ADMIN_API_KEY`. Keep these secrets on the backend only.
2. In the dashboard's alert subscription form, choose **SMS**, select a ward, enter a test phone that you control, check consent, and submit. On a Twilio trial, verify the recipient in Twilio and check that SMS to India is available for your account/sender. Current trial rules restrict sends to verified recipients and may restrict custom message bodies; HeatKshetra's alert text is custom, so an upgraded account may be needed for this exact SMS.
3. Open `http://127.0.0.1:8080/?risk-preview=extreme#city-actions`. The extreme preview is simulated in the browser and does not update live risk or broadcast an alert.
4. In **Extreme-risk SMS demo**, enter the same opted-in phone number and the server admin key, then click **Send real demo SMS**. This route sends exactly one demo message and logs the result. Show the extreme map, click the button, and include the phone receiving the SMS in your recording. You can also show the matching `SENT` entry under **Recent alert activity**.

Check Twilio's current [trial rules](https://www.twilio.com/docs/usage/trials) before recording: trial messaging has a limited free-message allowance, requires verified recipient numbers, and has custom-content restrictions. Don't include account credentials or real personal numbers in the video. The SMS is real and may appear with Twilio trial labeling; it is a demo alert, not an emergency warning.

## Useful checks

From the repository root:

```powershell
.venv\Scripts\python.exe -m compileall app scripts
```

From the frontend directory:

```powershell
bun run build
bun run lint
```
