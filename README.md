# Psycheros Launcher (Alpha)

Installer and launcher scripts for setting up Psycheros + entity-core for alpha testing.

## Quick Start

### Windows

1. Download or clone this repo
2. Right-click `install.ps1` → **Run with PowerShell**
3. Follow the prompts
4. When it's done, run `start.ps1`

### Mac / Linux

1. Download or clone this repo
2. Open a terminal and run:

```bash
chmod +x install.sh
./install.sh
```

3. Follow the prompts
4. When it's done, run:

```bash
cd ~/psycheros && ./start.sh
```

## What Gets Installed

The installer sets up everything in one directory (default `~/psycheros` or `%USERPROFILE%\psycheros`):

```
psycheros/
├── Psycheros/      ← main app
├── entity-core/    ← entity memory & identity
├── start.sh        ← launch the server (or start.ps1 on Windows)
├── stop.sh         ← stop the server (or stop.ps1)
└── update.sh       ← pull latest updates (or update.ps1)
```

## Prerequisites

The installer will check for these and offer to install Deno automatically:

- **Git** — needed to download the repos
- **Deno 2.x** — the runtime Psycheros runs on

If Git isn't installed:
- **Windows**: Download from https://git-scm.com/download/win
- **Mac**: Run `xcode-select --install` in Terminal
- **Linux**: Install via your package manager (`apt install git`, etc.)

## After Installing

1. Run `start.sh` (or `start.ps1`) to launch Psycheros
2. Open http://localhost:3000 in your browser
3. Go to **Settings** and enter your API key
4. Start chatting with your entity

## Updating

When there's a new version, just run:

```bash
./update.sh      # Mac/Linux
.\update.ps1     # Windows
```

This pulls the latest code from both Psycheros and entity-core. Then restart with `start.sh` / `start.ps1`.

## Stopping

```bash
./stop.sh        # Mac/Linux
.\stop.ps1       # Windows
```

Or press **Ctrl+C** in the terminal where Psycheros is running.

## Troubleshooting

**"Deno not found" after restart**
The installer adds Deno to your PATH, but some systems need a terminal restart to pick it up. Close and reopen your terminal.

**"Could not clone" error**
Check your internet connection and try again. If the problem persists, open an issue at the repository.

**First run is slow**
Deno downloads dependencies on first launch. This only happens once — subsequent starts are fast.

**Port 3000 already in use**
Something else is running on that port. Stop the other program, or check that you don't have another instance of Psycheros running.
