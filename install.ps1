# Psycheros Alpha Installer — Windows
# Run this in PowerShell: .\install.ps1

$PsycherosRepo = "https://github.com/zarilewis/Psycheros-alpha.git"
$EntityCoreRepo = "https://github.com/zarilewis/entity-core-alpha.git"

Write-Host ""
Write-Host "  =====================================" -ForegroundColor Cyan
Write-Host "    Psycheros Alpha Installer" -ForegroundColor Cyan
Write-Host "  =====================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Check prerequisites ---
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

# Git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Host "  Git is not installed." -ForegroundColor Red
    Write-Host "  Download it from: https://git-scm.com/download/win" -ForegroundColor White
    exit 1
}
Write-Host "  Git: $(& git --version)"

# Deno
$denoCmd = Get-Command deno -ErrorAction SilentlyContinue
if ($denoCmd) {
    $ver = & deno --version 2>$null | Select-Object -First 1
    Write-Host "  Deno: $ver" -ForegroundColor Green
} else {
    Write-Host "  Deno not found. Installing..." -ForegroundColor Yellow
    irm https://deno.land/install.ps1 | iex

    $denoCmd = Get-Command deno -ErrorAction SilentlyContinue
    if (-not $denoCmd) {
        Write-Host "  Deno installation failed." -ForegroundColor Red
        Write-Host "  Please install manually: https://deno.land" -ForegroundColor White
        exit 1
    }
    Write-Host "  Deno installed successfully." -ForegroundColor Green
    Write-Host "  If 'deno' isn't recognized, restart your terminal." -ForegroundColor Yellow
}
Write-Host ""

# --- Step 2: Install directory ---
$DefaultDir = "$HOME\psycheros"
Write-Host "[2/4] Choose install location" -ForegroundColor Yellow
$installDir = Read-Host "  Install directory? [$DefaultDir]"
if ([string]::IsNullOrWhiteSpace($installDir)) {
    $installDir = $DefaultDir
}
$installDir = $installDir.TrimEnd('\')
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Write-Host "  Using: $installDir" -ForegroundColor Green
Write-Host ""

# --- Step 3: Clone repos ---
Write-Host "[3/4] Downloading Psycheros and entity-core..." -ForegroundColor Yellow

function Clone-Repo {
    param([string]$Name, [string]$Url, [string]$Target)

    if (Test-Path "$Target\.git") {
        Write-Host "  $Name — already exists, updating..." -ForegroundColor Cyan
        Set-Location $Target
        git pull --ff-only
    } else {
        Write-Host "  Cloning $Name..." -ForegroundColor Cyan
        git clone $Url $Target
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Could not clone $Name. Check your internet connection and try again." -ForegroundColor Red
            Write-Host "  Manual command: git clone $Url $Target" -ForegroundColor White
            exit 1
        }
    }
}

Clone-Repo "Psycheros" $PsycherosRepo "$installDir\Psycheros"
Clone-Repo "entity-core" $EntityCoreRepo "$installDir\entity-core"
Write-Host ""

# --- Step 4: Settings ---
Write-Host "[4/4] Configuration" -ForegroundColor Yellow
Write-Host ""

$userName = Read-Host "  Your name? [You]"
if ([string]::IsNullOrWhiteSpace($userName)) { $userName = "You" }

$entityName = Read-Host "  Entity's name? [Assistant]"
if ([string]::IsNullOrWhiteSpace($entityName)) { $entityName = "Assistant" }

# Detect timezone
$tz = "UTC"
try {
    $detected = [System.TimeZoneInfo]::Local.Id
    if ($detected) { $tz = $detected }
} catch {}

$tzInput = Read-Host "  Timezone? [$tz]"
if (-not [string]::IsNullOrWhiteSpace($tzInput)) { $tz = $tzInput }

# Write settings
$psycherosDir = "$installDir\Psycheros"
$settingsDir = "$psycherosDir\.psycheros"
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

$settings = @{
    entityName = $entityName
    userName   = $userName
    timezone   = $tz
} | ConvertTo-Json
Set-Content -Path "$settingsDir\general-settings.json" -Value $settings -Encoding UTF8

Write-Host "  Settings saved." -ForegroundColor Green
Write-Host ""

# --- Generate launcher scripts ---
Write-Host "Creating launcher scripts..." -ForegroundColor Yellow

# start.ps1
$startContent = @'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$dir\Psycheros"

Write-Host ""
Write-Host "Starting Psycheros..." -ForegroundColor Cyan
Write-Host ""

Start-Sleep -Seconds 3
Start-Process "http://localhost:3000"

deno task start
'@
Set-Content -Path "$installDir\start.ps1" -Value $startContent -Encoding UTF8

# stop.ps1
$stopContent = @'
Write-Host "Stopping Psycheros..." -ForegroundColor Cyan
Get-Process -Name "deno" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Done." -ForegroundColor Green
'@
Set-Content -Path "$installDir\stop.ps1" -Value $stopContent -Encoding UTF8

# update.ps1
$updateContent = @'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "Updating Psycheros..." -ForegroundColor Cyan
Set-Location "$dir\Psycheros"
git pull --ff-only

Write-Host "Updating entity-core..." -ForegroundColor Cyan
Set-Location "$dir\entity-core"
git pull --ff-only

Write-Host ""
Write-Host "Update complete! Run .\start.ps1 to launch." -ForegroundColor Green
Write-Host ""
'@
Set-Content -Path "$installDir\update.ps1" -Value $updateContent -Encoding UTF8

Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# --- All done ---
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Your install directory:"
Write-Host "    $installDir\"
Write-Host "      Psycheros\      (main app)"
Write-Host "      entity-core\    (entity memory & identity)"
Write-Host "      start.ps1       (launch Psycheros)"
Write-Host "      stop.ps1        (stop Psycheros)"
Write-Host "      update.ps1      (pull latest updates)"
Write-Host ""
Write-Host "  To get started:" -ForegroundColor White
Write-Host "    cd $installDir && .\start.ps1" -ForegroundColor White
Write-Host ""
Write-Host "  On first run, Deno will download dependencies (this may take a moment)."
Write-Host "  After that, open http://localhost:3000 and add your API key in Settings."
Write-Host ""
