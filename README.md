# TrafficTwin: Spillback and the Ambulance

TrafficTwin simulates a three-junction city corridor. It shows how **spillback** (a full road blocking the junction behind it) spreads congestion and traps emergency vehicles, and it compares signal strategies that prevent it.

> Simplified educational model. It is not a certified traffic-engineering or signal-control system.

## The problem
When the road between two junctions is full, cars at the upstream junction cannot move, even on a green light. The jam spreads backwards along the corridor, and an ambulance stuck in it cannot get through.

## Our approach
| Strategy | What it does |
|---|---|
| **Fixed-time** | Every signal runs the same fixed cycle (baseline). |
| **Fixed + ambulance priority** | Fixed cycle, but signals give the ambulance a green wave. |
| **Coordinated + ambulance priority** | Signals check how full the next road is. They cut green early when the road ahead is almost full (no point sending cars into a jam) and extend green to flush a filling road. They also give the ambulance a green wave. |

**Safe ambulance pre-emption:** yellow and all-red clearance are **never skipped**, and each green always runs a minimum time. After the ambulance passes, every junction **recovers**: the side street that waited is served first, then the normal cycle resumes. Recovery time is measured.

## Features
- 3 signalised junctions (J0 → J1 → J2) joined by 2 roads (L0, L1) that hold a limited number of cars
- First-in-first-out queues, real spillback blocking, and spillback event counting
- Scenarios you can combine: **normal**, **peak hour**, **sudden traffic surge**, **blocked lane** (lanes closed for a time window), **spillback**, **ambulance**
- **Fair comparison**: all strategies get **identical traffic** from the same random seed
- **Seed check**: repeat a scenario over 3–10 seeds to show results are not luck
- **Playback** of the real recorded simulation: queues, signal lights, road occupancy, spillback, lane closure and ambulance position
- Metrics: cars arrived and finished, throughput, average delay, maximum queues, spillback events and blocked seconds, ambulance travel time and delay, signal recovery time
- 120 automated backend tests

## Example results (from this code)
Scenario: **Peak hour + Spillback + Ambulance**, averaged over seeds 42–46 (same traffic for every strategy within each seed):

| | Fixed-time | Fixed + ambulance priority | Coordinated + ambulance priority |
|---|---|---|---|
| Ambulance trip time | 913 s | 853 s | **434 s** |
| Seconds blocked by spillback | 1249 | 1820 | **524** |
| Cars that finished | 1138 | 1032 | **1198** |
| Average delay | **110 s** | 281 s | 161 s |

**Honest reading:** coordinated control with ambulance priority got the ambulance through about **2x faster** and cut spillback blocking by about **58%**. Ordinary cars waited longer on average than under fixed-time. Adding ambulance priority to fixed-time alone made spillback *worse*, which is why coordination matters.

## Run it (Windows PowerShell)
**Backend** (window 1):
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```
**Frontend** (window 2):
```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```
Open the address Vite prints (usually http://localhost:5173).

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Backend status |
| GET | `/api/scenarios` | Scenario presets and defaults |
| POST | `/api/scenarios/run` | Run chosen scenarios and strategies (with playback history) |
| POST | `/api/scenarios/multi-seed` | Repeat over several seeds and average |
| POST | `/api/corridor/compare` | Compare strategies for a custom configuration |
| GET | `/api/corridor/assumptions` | Model assumptions |

Interactive docs: http://127.0.0.1:8000/docs

## Model assumptions and limits
- 1-second time steps; random (Poisson) arrivals from a fixed seed
- Cars leave on green only, one every 2 s per lane; yellow and all-red count as lost time
- Roads have a fixed travel time and limited space; a car may not enter a full road
- A blocked lane reduces how fast that junction's main road can discharge (zero if all lanes are closed)
- One ambulance travelling eastbound; it queues with other cars (no overtaking)
- Not modelled: turning traffic, pedestrians, multiple ambulances, real sensor data
- The animation replays a finished simulation; it is not live road data

## Project structure
```
backend/app/main.py                 FastAPI app
backend/app/scenario_routes.py      Scenario API routes
backend/app/simulation/corridor.py  Corridor model, strategies, pre-emption, surge, lane closure
backend/app/simulation/scenarios.py Scenario presets and seed check
backend/tests/                      Automated tests
frontend/src/App.jsx                Dashboard
frontend/src/ScenarioLab.jsx        Scenario Lab: setup, playback, charts, comparison
```
