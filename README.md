# Psycheros Launcher

Install, update, and run Psycheros from your browser.

## Easy Mode (Recommended)

No command line needed. The dashboard is a web page with buttons for everything.

### Windows

1. Download these two files from the [latest release](https://github.com/zarilewis/psycheros-launcher/releases):
   - `run.ps1`
   - `dashboard.ts`
2. Put them both in the same folder (e.g., your Desktop)
3. Right-click `run.ps1` and click **Run with PowerShell**
4. A browser window will open automatically
5. Click **Install**, fill in the settings, then click **Start**

### Mac

1. Download these two files from the [latest release](https://github.com/zarilewis/psycheros-launcher/releases):
   - `run.sh`
   - `dashboard.ts`
2. Put them both in the same folder (e.g., your Desktop)
3. Open the **Terminal** app, then drag `run.sh` into the terminal window and press Enter
4. A browser window will open automatically
5. Click **Install**, fill in the settings, then click **Start**

### Linux

Same as Mac. Or in a terminal:

```bash
chmod +x run.sh
./run.sh
```

## What the Dashboard Does

The dashboard opens at http://localhost:3001 and has four buttons:

| Button | What it does |
|--------|-------------|
| **Install** | Downloads Psycheros and entity-core, saves your settings |
| **Update** | Pulls the latest code for both projects |
| **Start** | Launches the Psycheros server |
| **Stop** | Shuts down the Psycheros server |

There's also a **Settings** form where you can set your name, your entity's name, the install directory, and your timezone.

A **Log** panel at the bottom shows what's happening in real time.

## What Gets Installed

Everything goes into one directory (default `~/psycheros`):

```
psycheros/
├── Psycheros/      ← main app
└── entity-core/    ← entity memory & identity
```

## Prerequisites

None. The launcher installs Deno automatically if you don't have it. Git is optional — if you have it, updates use `git pull` (fast). If you don't, updates download the repos directly (works fine, just slower).

## After Installing

1. Click **Start** in the dashboard
2. Open http://localhost:3000 in your browser
3. Go to **Settings** and enter your API key
4. Start chatting with your entity

## Command Line (Advanced)

If you prefer the terminal, the old scripts still work:

### Windows
```powershell
.\install.ps1
.\start.ps1
.\stop.ps1
.\update.ps1
```

### Mac / Linux
```bash
./install.sh
./start.sh
./stop.sh
./update.sh
```

## Troubleshooting

**"Deno not found" after restart**
Some systems need a terminal restart to pick up the new PATH. Close and reopen your terminal.

**"Could not clone" error**
Check your internet connection and try again.

**First run is slow**
Deno downloads dependencies on the first launch. This only happens once.

**Port 3000 already in use**
Stop the other program using that port, or make sure you don't have another instance of Psycheros running.

**Dashboard won't open**
Make sure `run.ps1` (or `run.sh`) and `dashboard.ts` are in the same folder.
