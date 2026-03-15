<#
.SYNOPSIS
    Setup and manage Credential Vault backend and frontend services on Windows.

.DESCRIPTION
    Automates starting, installing (auto-start on Windows boot), and removing
    the Credential Vault backend (FastAPI/Uvicorn) and frontend (React/Vite).

    Without parameters, starts both services interactively for development.
    Use -Install to configure auto-start on Windows boot.
    Use -Remove to remove auto-start and stop running services.

.PARAMETER Install
    Check prerequisites, setup dependencies, and configure auto-start on Windows boot.
    Creates a runner script and adds a startup shortcut.

.PARAMETER Remove
    Stop running services, remove runner script, and remove startup shortcut.

.PARAMETER Verify
    Verify that services are running and configuration is intact.

.PARAMETER Force
    Force reconfiguration even if already installed.

.EXAMPLE
    .\Setup-CredentialVault.ps1
    Start backend and frontend services interactively.

.EXAMPLE
    .\Setup-CredentialVault.ps1 -Install
    Install dependencies and configure auto-start on Windows boot.

.EXAMPLE
    .\Setup-CredentialVault.ps1 -Remove
    Remove auto-start configuration and stop services.

.EXAMPLE
    .\Setup-CredentialVault.ps1 -Verify
    Check status of services and auto-start configuration.
#>
[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
    [Parameter(ParameterSetName = 'Install')]
    [switch]$Install,

    [Parameter(ParameterSetName = 'Remove')]
    [switch]$Remove,

    [Parameter(ParameterSetName = 'Verify')]
    [switch]$Verify,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────

$scriptPath      = $PSScriptRoot
$repoRoot        = Split-Path -Parent (Split-Path -Parent $scriptPath)
$pythonExe       = Join-Path $repoRoot ".venv\Scripts\python.exe"
$frontendDir     = Join-Path $repoRoot "frontend"
$userScriptsDir  = Join-Path $env:USERPROFILE "Scripts"
$runnerScript    = Join-Path $userScriptsDir "Start-CredentialVault.ps1"
$startupFolder   = [Environment]::GetFolderPath("Startup")
$startupShortcut = Join-Path $startupFolder "Start-CredentialVault.lnk"
$logDir          = Join-Path $repoRoot "logs"
$backendPort     = 8000
$frontendPort    = 3000

# ── Helpers ──────────────────────────────────────────────────────────────

function Write-Status {
    param([string]$Message, [string]$Type = "INFO")
    $colors = @{ INFO = "Cyan"; OK = "Green"; WARN = "Yellow"; ERROR = "Red" }
    $color = if ($colors.ContainsKey($Type)) { $colors[$Type] } else { "White" }
    Write-Host "[$Type] " -ForegroundColor $color -NoNewline
    Write-Host $Message
}

function Test-Port {
    param([int]$Port)
    try {
        $conn = New-Object System.Net.Sockets.TcpClient
        $conn.Connect("127.0.0.1", $Port)
        $conn.Close()
        return $true
    } catch {
        return $false
    }
}

function Test-Prerequisites {
    $ok = $true

    # Python
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        $pyVer = & python --version 2>&1
        Write-Status "Python: $pyVer" "OK"
    } else {
        Write-Status "Python not found in PATH" "ERROR"
        $ok = $false
    }

    # Node.js
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $nodeVer = & node --version 2>&1
        Write-Status "Node.js: $nodeVer" "OK"
    } else {
        Write-Status "Node.js not found in PATH" "ERROR"
        $ok = $false
    }

    # npm
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) {
        $npmVer = & npm --version 2>&1
        Write-Status "npm: $npmVer" "OK"
    } else {
        Write-Status "npm not found in PATH" "ERROR"
        $ok = $false
    }

    # .env file
    $envFile = Join-Path $repoRoot ".env"
    if (Test-Path $envFile) {
        Write-Status ".env file found" "OK"
    } else {
        Write-Status ".env file not found (copy from .env.example)" "WARN"
    }

    return $ok
}

function Stop-ServiceProcesses {
    # Stop backend (uvicorn on $backendPort)
    $backendConns = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
    if ($backendConns) {
        foreach ($conn in $backendConns) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Status "Stopping backend process: $($proc.Name) (PID $($proc.Id))" "INFO"
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Status "Backend stopped" "OK"
    } else {
        Write-Status "No backend process found on port $backendPort" "INFO"
    }

    # Stop frontend (Vite on $frontendPort)
    $frontendConns = Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction SilentlyContinue
    if ($frontendConns) {
        foreach ($conn in $frontendConns) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Status "Stopping frontend process: $($proc.Name) (PID $($proc.Id))" "INFO"
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Status "Frontend stopped" "OK"
    } else {
        Write-Status "No frontend process found on port $frontendPort" "INFO"
    }
}

# ── Install ──────────────────────────────────────────────────────────────

function Invoke-Install {
    Write-Status "Installing Credential Vault auto-start..." "INFO"
    Write-Host ""

    # Check if already installed
    if ((Test-Path $runnerScript) -and (Test-Path $startupShortcut) -and (-not $Force)) {
        Write-Status "Already installed. Use -Force to reinstall." "WARN"
        return
    }

    # Prerequisites
    if (-not (Test-Prerequisites)) {
        Write-Status "Prerequisites check failed. Install missing tools first." "ERROR"
        return
    }
    Write-Host ""

    # Setup Python venv
    Write-Status "Setting up Python virtual environment..." "INFO"
    if (-not (Test-Path $pythonExe)) {
        & python -m venv (Join-Path $repoRoot ".venv")
    }
    Write-Status "Python venv ready" "OK"

    # Install Python dependencies
    Write-Status "Installing Python dependencies..." "INFO"
    $pipExe = Join-Path $repoRoot ".venv\Scripts\pip.exe"
    & $pipExe install -e "$repoRoot" --quiet 2>&1 | Out-Null
    Write-Status "Python dependencies installed" "OK"

    # Run database migrations
    Write-Status "Running database migrations..." "INFO"
    Push-Location $repoRoot
    try {
        & $pythonExe -m alembic upgrade head 2>&1 | Out-Null
        Write-Status "Database migrations complete" "OK"
    } finally {
        Pop-Location
    }

    # Install frontend dependencies
    Write-Status "Installing frontend dependencies..." "INFO"
    Push-Location $frontendDir
    try {
        & npm install --silent 2>&1 | Out-Null
        Write-Status "Frontend dependencies installed" "OK"
    } finally {
        Pop-Location
    }

    Write-Host ""

    # Create logs directory
    if (-not (Test-Path $logDir)) {
        New-Item -Path $logDir -ItemType Directory -Force | Out-Null
    }

    # Create user scripts directory
    if (-not (Test-Path $userScriptsDir)) {
        New-Item -Path $userScriptsDir -ItemType Directory -Force | Out-Null
    }

    # Generate runner script
    Write-Status "Creating runner script: $runnerScript" "INFO"
    $runnerContent = @"
# Auto-generated by Setup-CredentialVault.ps1
# Starts Credential Vault backend and frontend services

`$repoRoot    = "$repoRoot"
`$pythonExe   = "$pythonExe"
`$frontendDir = "$frontendDir"
`$logDir      = "$logDir"
`$timestamp   = Get-Date -Format "yyyy-MM-dd"

# Ensure log directory exists
if (-not (Test-Path `$logDir)) { New-Item -Path `$logDir -ItemType Directory -Force | Out-Null }

# Start backend (FastAPI / Uvicorn)
Start-Process -FilePath `$pythonExe ``
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" ``
    -WorkingDirectory `$repoRoot ``
    -WindowStyle Hidden ``
    -RedirectStandardOutput "`$logDir\backend-`$timestamp.out.log" ``
    -RedirectStandardError  "`$logDir\backend-`$timestamp.err.log"

# Wait for backend to be ready
Start-Sleep -Seconds 3

# Start frontend (Vite dev server with API proxy)
Start-Process -FilePath "cmd.exe" ``
    -ArgumentList "/c", "cd /d `"`$frontendDir`" && npm run dev" ``
    -WorkingDirectory `$frontendDir ``
    -WindowStyle Hidden ``
    -RedirectStandardOutput "`$logDir\frontend-`$timestamp.out.log" ``
    -RedirectStandardError  "`$logDir\frontend-`$timestamp.err.log"
"@
    Set-Content -Path $runnerScript -Value $runnerContent -Encoding UTF8
    Write-Status "Runner script created" "OK"

    # Create startup shortcut
    Write-Status "Creating startup shortcut..." "INFO"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($startupShortcut)
    $Shortcut.TargetPath       = "powershell.exe"
    $Shortcut.Arguments        = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerScript`""
    $Shortcut.WorkingDirectory = $repoRoot
    $Shortcut.WindowStyle      = 7  # Minimized
    $Shortcut.Description      = "Start Credential Vault services"
    $Shortcut.Save()
    Write-Status "Startup shortcut created: $startupShortcut" "OK"

    Write-Host ""
    Write-Status "Installation complete!" "OK"
    Write-Status "Services will auto-start on next Windows boot." "INFO"
    Write-Status "Backend:  http://localhost:$backendPort" "INFO"
    Write-Status "Frontend: http://localhost:$frontendPort" "INFO"
}

# ── Remove ───────────────────────────────────────────────────────────────

function Invoke-Remove {
    Write-Status "Removing Credential Vault auto-start..." "INFO"
    Write-Host ""

    # Stop running services
    Stop-ServiceProcesses
    Write-Host ""

    # Remove runner script
    if (Test-Path $runnerScript) {
        Remove-Item -Path $runnerScript -Force
        Write-Status "Runner script removed: $runnerScript" "OK"
    } else {
        Write-Status "Runner script not found (already removed)" "INFO"
    }

    # Remove startup shortcut
    if (Test-Path $startupShortcut) {
        Remove-Item -Path $startupShortcut -Force
        Write-Status "Startup shortcut removed: $startupShortcut" "OK"
    } else {
        Write-Status "Startup shortcut not found (already removed)" "INFO"
    }

    # Clean log files
    if (Test-Path $logDir) {
        $logFiles = Get-ChildItem -Path $logDir -File -ErrorAction SilentlyContinue
        if ($logFiles) {
            Remove-Item -Path "$logDir\*" -Force
            Write-Status "Log files cleaned: $logDir" "OK"
        }
    }

    Write-Host ""
    Write-Status "Removal complete." "OK"
}

# ── Verify ───────────────────────────────────────────────────────────────

function Invoke-Verify {
    Write-Status "Verifying Credential Vault status..." "INFO"
    Write-Host ""

    # Backend
    if (Test-Port $backendPort) {
        Write-Status "Backend is running on port $backendPort" "OK"
        try {
            $health = Invoke-RestMethod -Uri "http://localhost:$backendPort/health" -TimeoutSec 5
            Write-Status "  Health check: $($health.status)" "OK"
        } catch {
            Write-Status "  Health endpoint not responding" "WARN"
        }
    } else {
        Write-Status "Backend is NOT running on port $backendPort" "ERROR"
    }

    # Frontend
    if (Test-Port $frontendPort) {
        Write-Status "Frontend is running on port $frontendPort" "OK"
    } else {
        Write-Status "Frontend is NOT running on port $frontendPort" "ERROR"
    }

    Write-Host ""

    # Runner script
    if (Test-Path $runnerScript) {
        Write-Status "Runner script exists: $runnerScript" "OK"
    } else {
        Write-Status "Runner script not found (not installed)" "WARN"
    }

    # Startup shortcut
    if (Test-Path $startupShortcut) {
        Write-Status "Startup shortcut exists: $startupShortcut" "OK"
    } else {
        Write-Status "Startup shortcut not found (not installed)" "WARN"
    }

    # Log files
    if (Test-Path $logDir) {
        $logFiles = Get-ChildItem -Path $logDir -File -ErrorAction SilentlyContinue
        if ($logFiles) {
            Write-Status "Log files: $($logFiles.Count) file(s) in $logDir" "INFO"
        }
    }
}

# ── Run (default) ────────────────────────────────────────────────────────

function Invoke-Run {
    Write-Status "Starting Credential Vault (dev mode)..." "INFO"
    Write-Host ""

    # Check venv
    if (-not (Test-Path $pythonExe)) {
        Write-Status "Python venv not found. Run with -Install first." "ERROR"
        return
    }

    # Check frontend node_modules
    $nodeModules = Join-Path $frontendDir "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Status "Frontend dependencies not installed. Run with -Install first." "ERROR"
        return
    }

    # Check if ports are already in use
    if (Test-Port $backendPort) {
        Write-Status "Port $backendPort already in use. Stop existing service first." "WARN"
        return
    }

    # Start backend
    Write-Status "Starting backend (uvicorn --reload) on port $backendPort..." "INFO"
    $backendJob = Start-Process -FilePath $pythonExe `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "$backendPort" `
        -WorkingDirectory $repoRoot `
        -PassThru

    Start-Sleep -Seconds 2

    # Start frontend
    Write-Status "Starting frontend (vite dev) on port $frontendPort..." "INFO"
    $frontendJob = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "cd /d `"$frontendDir`" && npm run dev" `
        -WorkingDirectory $frontendDir `
        -PassThru

    Start-Sleep -Seconds 2

    Write-Host ""
    Write-Status "Services started!" "OK"
    Write-Status "Backend:  http://localhost:$backendPort" "INFO"
    Write-Status "Frontend: http://localhost:$frontendPort" "INFO"
    Write-Host ""
    Write-Status "Press Ctrl+C or close this window to stop." "INFO"

    try {
        while (-not $backendJob.HasExited -and -not $frontendJob.HasExited) {
            Start-Sleep -Seconds 1
        }
    } finally {
        if (-not $backendJob.HasExited)  { Stop-Process -Id $backendJob.Id  -Force -ErrorAction SilentlyContinue }
        if (-not $frontendJob.HasExited) { Stop-Process -Id $frontendJob.Id -Force -ErrorAction SilentlyContinue }
        Write-Status "Services stopped." "INFO"
    }
}

# ── Main ─────────────────────────────────────────────────────────────────

switch ($PSCmdlet.ParameterSetName) {
    'Install' { Invoke-Install }
    'Remove'  { Invoke-Remove }
    'Verify'  { Invoke-Verify }
    default   { Invoke-Run }
}
