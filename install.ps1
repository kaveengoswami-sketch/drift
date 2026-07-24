# Drift Installer Script for Windows
# Usage:
#   1-liner: irm https://raw.githubusercontent.com/kaveengoswami-sketch/drift/main/install.ps1 | iex
#   From source: .\install.ps1 -FromSource

[CmdletBinding()]
param(
    [switch]$FromSource,
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Drift",
    [string]$Repo = "kaveengoswami-sketch/drift"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "         Installing Drift               " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$IsLocalRepo = Test-Path (Join-Path $ScriptDir "package.json")

# Determine whether to build from local source or fetch release
if ($FromSource -or $IsLocalRepo) {
    Write-Host "`n[1/3] Building Drift from local source..." -ForegroundColor Yellow
    
    $BuildSourceDir = if ($IsLocalRepo) { $ScriptDir } else { Get-Location }
    Set-Location $BuildSourceDir
    
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Error "Node.js and npm are required to build from source. Please install Node.js (https://nodejs.org/)."
        exit 1
    }

    Write-Host " -> Running npm install..." -ForegroundColor Gray
    npm install --no-audit --no-fund
    
    Write-Host " -> Building Electron application..." -ForegroundColor Gray
    npm run build

    Write-Host " -> Packaging output binaries..." -ForegroundColor Gray
    npx electron-builder --dir

    $UnpackedDir = Join-Path $BuildSourceDir "dist\win-unpacked"
    if (-not (Test-Path $UnpackedDir)) {
        Write-Error "Build failed: output directory $UnpackedDir does not exist."
        exit 1
    }

    Write-Host "`n[2/3] Installing files to $InstallDir..." -ForegroundColor Yellow
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Recurse -Force "$UnpackedDir\*" $InstallDir

} else {
    Write-Host "`n[1/3] Fetching latest release from GitHub ($Repo)..." -ForegroundColor Yellow
    
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "Drift-Installer" }
        $Asset = $Release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
    } catch {
        $Asset = $null
    }

    if ($Asset) {
        $TempExe = Join-Path $env:TEMP $Asset.name
        Write-Host " -> Downloading $($Asset.name)..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $TempExe
        
        Write-Host "`n[2/3] Executing installer..." -ForegroundColor Yellow
        Start-Process -FilePath $TempExe -ArgumentList "/S /D=$InstallDir" -Wait
        Remove-Item -Force $TempExe -ErrorAction SilentlyContinue
    } else {
        Write-Host " -> No pre-built release binary found. Cloning repository to build from source..." -ForegroundColor Yellow
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            Write-Error "Git is required to clone the repository. Please install Git."
            exit 1
        }
        
        $CloneDir = Join-Path $env:TEMP "drift-build-temp"
        if (Test-Path $CloneDir) { Remove-Item -Recurse -Force $CloneDir }
        
        git clone "https://github.com/$Repo.git" $CloneDir
        Set-Location $CloneDir
        
        npm install --no-audit --no-fund
        npm run build
        npx electron-builder --dir
        
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item -Recurse -Force "dist\win-unpacked\*" $InstallDir
        
        Remove-Item -Recurse -Force $CloneDir -ErrorAction SilentlyContinue
    }
}

# Step 3: Create Start Menu shortcut & CLI command
Write-Host "`n[3/3] Setting up shortcuts and CLI command..." -ForegroundColor Yellow

$ExePath = Join-Path $InstallDir "Drift.exe"
if (-not (Test-Path $ExePath)) {
    Write-Error "Drift.exe not found at $ExePath."
    exit 1
}

# Start Menu Shortcut
$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$ShortcutPath = Join-Path $StartMenuDir "Drift.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.IconLocation = "$ExePath,0"
$Shortcut.Save()
Write-Host " -> Created Start Menu shortcut: Drift" -ForegroundColor Gray

# CLI Wrapper (drift.cmd in WindowsApps or LocalAppData bin)
$WinAppsDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
if (Test-Path $WinAppsDir) {
    $CmdPath = Join-Path $WinAppsDir "drift.cmd"
    "@echo off`r`nstart `"`" `"$ExePath`" %*" | Out-File -Encoding ascii -FilePath $CmdPath -Force
    Write-Host " -> Created CLI command: 'drift' (in WindowsApps)" -ForegroundColor Gray
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "     Drift installed successfully!       " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Launch Drift from Start Menu or type 'drift' in your terminal." -ForegroundColor White
