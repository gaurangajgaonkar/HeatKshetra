# HeatKshetra

**Ward-level heat-risk monitoring for Mumbai, with a design intended to scale across India.**

HeatKshetra is a Smart India Hackathon prototype for Problem Statement 83. It brings live weather, ward boundaries, population and vulnerability inputs, heat-risk calculations, a GIS dashboard, advisories, and opt-in alerts into one system.

## Problem statement

Heat warnings often focus on air temperature. But the heat a person experiences also depends on humidity, wind, solar exposure, and personal or neighbourhood vulnerability. A temperature threshold alone cannot show which wards may face greater heat stress or where timely precautions may matter most.

The challenge is to turn weather information into localized, actionable heat-risk guidance, with ward-level mapping, short-range forecasts, public advisories, and alert delivery.

## Proposed solution

HeatKshetra connects data, risk calculations, maps, and alerts:

1. **Bring together local inputs:** Open-Meteo weather and forecasts, Mumbai ward boundaries, census-based population inputs, and ward vulnerability profiles.
2. **Calculate heat-stress indicators:** Compute Heat Index and a simplified WBGT estimate from available weather inputs.
3. **Estimate a ward-level Mortality Risk Index (MRI):** Combine a temperature-relative-risk curve with weighted vulnerability factors.
4. **Show a five-day ward heat-risk forecast:** Apply forecast weather to ward risk calculations and present the results on a colour-coded GIS map.
5. **Turn risk into guidance:** Display public advisories and heat-action suggestions for the selected risk level.
6. **Deliver opt-in alerts:** Support SMS/WhatsApp through Twilio and browser push through Firebase Cloud Messaging, with delivery activity recorded in SQLite.
7. **Project population as census data changes:** Calculate Greater Mumbai’s CAGR from the latest two available city totals and apply it to ward census inputs. New official census rows can be added and picked up on refresh.

### How the MRI is calculated

The prototype calculates:

`MRI = Temperature Relative Risk × Vulnerability Index`

The vulnerability index weights elderly population (30%), outdoor workers (30%), informal housing (20%), and a comorbidity proxy (20%). The result is an **estimated risk score**, not a predicted death count or an individual probability.

## Unique value propositions

- **Weather translated into human heat risk:** Combines Heat Index and simplified WBGT with a transparent, vulnerability-weighted MRI rather than relying on air temperature alone.
- **Census-aware population estimates:** Uses Greater Mumbai census growth to update ward population projections, and can recalculate when newer official census figures are added.
- **Ward-level view linked to action:** Connects colour-coded ward risk, five-day heat-risk forecasts, advisories, and opt-in alert delivery in one workflow.

## What the current prototype demonstrates

- A live-weather dashboard backed by Open-Meteo.
- A Mumbai ward map using GeoJSON boundaries and OpenStreetMap tiles.
- Heat Index, simplified WBGT, vulnerability inputs, and an estimated MRI.
- Five-day **ward heat-risk** forecasts.
- Risk-level public advisories and heat-action guidance.
- SMS/WhatsApp and browser-push alert workflows, with SQLite delivery records.
- Census-based ward population projection using the available census inputs.

**Forecast output:** The five-day view shows ward heat-risk scores; the MRI is a deterministic, estimated risk index.

## Technology stack

- **Frontend:** React, TypeScript, TanStack Start, Vite
- **Backend:** Python, FastAPI, Pydantic, Uvicorn
- **GIS:** React-Leaflet, Leaflet, GeoJSON, OpenStreetMap
- **Weather:** Open-Meteo API
- **Database:** SQLite
- **Alerts:** Twilio REST API and Firebase Cloud Messaging


## Architecture at a glance

```text
Open-Meteo + census/ward inputs + GeoJSON
                    |
                    v
          Python / FastAPI services
     weather · heat metrics · MRI · forecast
                    |
                    v
                  SQLite
                    |
                    v
       React / TypeScript dashboard
       Leaflet map + ward risk display
                    |
           advisories and opt-in alerts
             /                    \
      Twilio SMS/WhatsApp     Firebase browser push
             \                    /
                SQLite alert logs
```

## Run locally on Windows

You need Python, [Bun](https://bun.sh/), and Git. Run the backend and frontend in **two separate PowerShell windows**.

The repository root is the folder containing `app`, `db`, `requirements.txt`, and this README. If it is on your Desktop as `sih2026`, use:

```powershell
cd "$HOME\Desktop\sih2026"
```

### First-time setup: backend

From the repository root:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

The API runs at <http://127.0.0.1:8000>. Interactive API documentation is at <http://127.0.0.1:8000/docs>; health status is at <http://127.0.0.1:8000/health>.

### First-time setup: frontend

In the second PowerShell window:

```powershell
cd "$HOME\Desktop\sih2026\HeatKshetra-main\Downloads\heat-aware-heartland-main\heat-aware-heartland-main"
bun install --frozen-lockfile
Copy-Item .env.example .env
bun run dev
```

Open <http://127.0.0.1:8080>. If Vite reports a different port, use the URL shown in the terminal.

### Starting it again

In the backend window:

```powershell
cd "$HOME\Desktop\sih2026"
.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

In the frontend window:

```powershell
cd "$HOME\Desktop\sih2026\HeatKshetra-main\Downloads\heat-aware-heartland-main\heat-aware-heartland-main"
bun run dev
```

Keep both terminals open while using the app. Press **Ctrl+C** in each window to stop its server. If PowerShell blocks environment activation, run the backend with:

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

## Suggested judge demo

1. Open the dashboard and point out the Open-Meteo source and current observation time.
2. Select a forecast day and show how ward risk colours change on the GIS map.
3. Select a ward and explain the estimated MRI and its vulnerability inputs.
4. Show the advisory and heat-action guidance for that risk level.
5. Demonstrate an opt-in alert using a test phone or browser. Show the actual message/notification and the resulting alert-log entry when provider credentials are configured.
6. Explain that the current prototype covers Mumbai and that the data-driven approach is designed for expansion to other Indian cities and states.

For a visual walkthrough of the extreme-risk UI, append `?risk-preview=extreme#city-actions` to the frontend URL. This preview changes displayed example risk only; it does not update the database or send an alert. To show real delivery, use the demo-send action with a test recipient and configured provider credentials. Label any preview data as a demonstration.

## Alert setup for a live demo

A normal local dashboard run does not require Twilio or Firebase credentials. Live message delivery does.

### Twilio SMS/WhatsApp

Set these values in the **repository-root** `.env`:

```dotenv
ADMIN_API_KEY=choose-a-local-secret
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_WHATSAPP_FROM=
```

Use valid credentials and a test recipient you control. Trial accounts may require verified recipients. Do not put Twilio secrets in the frontend `.env` or commit either `.env` file.

### Firebase browser push (optional)

Configure the Firebase web-app values in the frontend `.env` using its `.env.example`. Configure `FIREBASE_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS` in the repository-root `.env` with a service-account key stored outside the repository. See the [Firebase web push setup](https://firebase.google.com/docs/cloud-messaging/web/get-started).

## Data and attribution

- **Weather:** Open-Meteo. Current conditions and forecasts are weather-model estimates, not ward-level sensor measurements. Refresh interval defaults to 30 minutes.
- **Ward geometry:** `app/data/MUMBAI.geojson`, sourced from [datta07/INDIAN-SHAPEFILES](https://github.com/datta07/INDIAN-SHAPEFILES).
- **Population:** `app/data/ward_population_census.csv` and `app/data/greater_mumbai_census_totals.csv`. The projection uses the latest two city census totals available in these files.
- **Vulnerability:** `app/data/wards_demographics.csv`. Bundled profiles are prototype inputs and can be replaced with validated official ward-level data for wider deployment.
- **Map tiles:** OpenStreetMap contributors. The app displays map attribution in the map.

When new official census data becomes available, add ward-level rows and the corresponding Greater Mumbai total to the CSVs. The population refresh re-reads the files on its scheduled cycle (30 minutes by default) or when the API is restarted.

## API routes used by the dashboard

| Route | Purpose |
| --- | --- |
| `GET /wards/geojson?day=0..4` | Ward boundaries and map risk values |
| `GET /forecast/city?days=5` | City and ward forecast summary |
| `GET /ward/{ward_id}/mri` | Ward MRI and risk details |
| `GET /advisories/{risk_level}` | Public advisory text |
| `GET /action-plan/{risk_level}` | Risk-level action guidance |
| `POST /subscribe` | SMS/WhatsApp opt-in |
| `POST /alerts/trigger` | Admin-authorized regional alert |
| `POST /alerts/demo-sms` | One-recipient SMS demonstration |
| `POST /push/subscribe` | Browser-push opt-in |
| `POST /alerts/demo-push` | One-browser push demonstration |
| `GET /alerts/log` | Recent alert delivery activity |

## Project structure

```text
sih2026/
├── app/                         # FastAPI backend and risk calculations
├── app/data/                    # Ward, census, and vulnerability inputs
├── db/schema.sql                # SQLite schema
├── scripts/                     # Ward seed and population refresh scripts
├── tests/                       # Backend tests
└── HeatKshetra-main/Downloads/
    └── heat-aware-heartland-main/heat-aware-heartland-main/
        └── src/                 # React + TypeScript frontend
```

## Keep credentials private

The root and frontend `.env` files are local configuration and are excluded from Git. Commit changes to `.env.example` only when documenting new variable names; never commit API tokens, service-account JSON, or personal phone numbers.
