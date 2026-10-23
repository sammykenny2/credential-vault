<#
.SYNOPSIS
    Deploy and maintain the Credential Vault Docker stack on this machine.

.DESCRIPTION
    Production counterpart of Setup-CredentialVault.ps1 (which runs the
    development servers). Runs docker-compose.yaml with .env.production: the
    Tailscale sidecar, the backend (FastAPI) and the frontend (nginx). The
    containers use restart: unless-stopped, so once deployed they come back
    whenever Docker starts and nothing has to be launched after a reboot.

    The vault database lives in the credential-vault_vault_data volume, never
    in .\data (that is the development database).

    Every action is a thin wrapper over docker compose plus
    "python -m app.maintenance" inside the backend image, so the same steps
    work by hand, or from a shell script, on any other Docker host.

    Without parameters, deploys: build the images, stop the backend, back up
    the database, start the stack and wait for the health checks.

.PARAMETER Backup
    Copy the vault database out of the volume into -BackupDir.

.PARAMETER Restore
    Replace the vault database with the given SQLite file: a backup made by
    this script, or the database of another installation. The current
    database is backed up first.

.PARAMETER Rollback
    Go back to the images that were running before the last deploy and
    restore the database backup that deploy took.

.PARAMETER Status
    Show container health, the tailnet address and recent backups.

.PARAMETER Stop
    Stop the stack. It stays stopped across reboots until the next deploy.

.PARAMETER BackupDir
    Where backups are written and looked up. Default: <repo>\backups.

.PARAMETER TimeoutSeconds
    How long to wait for the health checks. Default: 180.

.EXAMPLE
    .\Deploy-CredentialVault.ps1
    Build and deploy (or update) the stack.

.EXAMPLE
    .\Deploy-CredentialVault.ps1 -Backup
    Write backups\backup-<timestamp>.db.

.EXAMPLE
    .\Deploy-CredentialVault.ps1 -Restore .\backups\backup-20261024-120000.db
    Replace the vault database with that backup.

.EXAMPLE
    .\Deploy-CredentialVault.ps1 -Rollback
    Undo the last deploy.
#>
[CmdletBinding(DefaultParameterSetName = 'Deploy', SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(ParameterSetName = 'Backup')]
    [switch]$Backup,

    [Parameter(ParameterSetName = 'Restore', Mandatory = $true)]
    [string]$Restore,

    [Parameter(ParameterSetName = 'Rollback')]
    [switch]$Rollback,

    [Parameter(ParameterSetName = 'Status')]
    [switch]$Status,

    [Parameter(ParameterSetName = 'Stop')]
    [switch]$Stop,

    [string]$BackupDir,

    [int]$TimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Paths and names ──────────────────────────────────────────────────────

$repoRoot    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$composeFile = Join-Path $repoRoot "docker-compose.yaml"
$envFile     = Join-Path $repoRoot ".env.production"
# Resolve caller-relative paths before the script moves to the repo root.
if ($BackupDir) {
    $BackupDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($BackupDir)
} else {
    $BackupDir = Join-Path $repoRoot "backups"
}
if ($Restore) { $Restore = (Resolve-Path -LiteralPath $Restore).Path }
$services    = @("tailscale", "backend", "frontend")
$builtImages = @{ backend = "credential-vault-backend"; frontend = "credential-vault-frontend" }
$stateVolume = "credential-vault_tailscale_state"

# ── Helpers ──────────────────────────────────────────────────────────────

function Write-Status {
    param([string]$Message, [string]$Type = "INFO")
    $colors = @{ INFO = "Cyan"; OK = "Green"; WARN = "Yellow"; ERROR = "Red" }
    $color = if ($colors.ContainsKey($Type)) { $colors[$Type] } else { "White" }
    Write-Host "[$Type] " -ForegroundColor $color -NoNewline
    Write-Host $Message
}

function Invoke-Compose {
    # docker compose for this stack; throws on a non-zero exit code.
    & docker compose --file $composeFile --env-file $envFile @args
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($args -join ' ') failed (exit code $LASTEXITCODE)"
    }
}

function Invoke-Docker {
    # docker without throwing; stderr is dropped. Returns stdout lines.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker @args 2>$null
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-EnvValue {
    param([string]$Name)
    foreach ($line in Get-Content $envFile) {
        if ($line -match "^\s*$Name\s*=\s*(.*)$") { return $Matches[1].Trim() }
    }
    return ""
}

function Get-ImageTag {
    $tag = Get-EnvValue "VAULT_IMAGE_TAG"
    if ($tag) { return $tag } else { return "local" }
}

function Test-Prerequisites {
    # -Start: the action brings the stack up, so it also needs valid secrets.
    param([switch]$Start)
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "docker was not found in PATH. Install Docker Desktop (or Docker Engine)."
    }
    $null = Invoke-Docker info --format "{{.ServerVersion}}"
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running. Start Docker Desktop and try again."
    }
    if (-not (Test-Path $envFile)) {
        throw ".env.production not found. Copy .env.production.example to .env.production and fill it in."
    }
    if (-not $Start) { return }

    $secret = Get-EnvValue "SECRET_KEY"
    if ($secret.Length -lt 32 -or $secret -like "replace-with-*") {
        throw "SECRET_KEY in .env.production is missing or a placeholder."
    }

    # The auth key is only needed until the sidecar has joined the tailnet;
    # after that the node identity lives in the tailscale_state volume.
    $authKey = Get-EnvValue "TS_AUTHKEY"
    $null = Invoke-Docker volume inspect $stateVolume
    $joined = $LASTEXITCODE -eq 0
    if ((-not $authKey -or $authKey -match "^tskey-auth-x+") -and -not $joined) {
        throw "TS_AUTHKEY in .env.production is a placeholder. Create an auth key at https://login.tailscale.com/admin/settings/keys"
    }

    if ((Get-EnvValue "GOOGLE_CLIENT_ID") -like "your-google-client-id*") {
        Write-Status "GOOGLE_CLIENT_ID is a placeholder; only the break-glass admin login will work" "WARN"
    }
}

function Get-ServiceContainer {
    param([string]$Service)
    $id = Invoke-Compose ps --all --quiet $Service
    if ($id) { return @($id)[0].Trim() }
    return $null
}

function Get-ContainerHealth {
    param([string]$ContainerId)
    $state = Invoke-Docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ContainerId
    if ($state) { return "$state".Trim() }
    return "missing"
}

function Get-TailnetState {
    # BackendState and the HTTPS name the sidecar got on the tailnet.
    $id = Get-ServiceContainer "tailscale"
    if (-not $id) { return $null }
    $json = Invoke-Docker exec $id tailscale status --json
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $state = ($json -join "`n") | ConvertFrom-Json
    $self = Get-JsonProperty $state "Self"
    return [pscustomobject]@{
        BackendState = "$(Get-JsonProperty $state 'BackendState')"
        DnsName      = "$(Get-JsonProperty $self 'DNSName')".TrimEnd(".")
    }
}

function Get-JsonProperty {
    # Property lookup that tolerates missing fields under StrictMode.
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function Wait-StackHealthy {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $pending = [System.Collections.Generic.List[string]]::new()
    $services | ForEach-Object { $pending.Add($_) }

    while ($pending.Count -gt 0) {
        foreach ($service in @($pending)) {
            $id = Get-ServiceContainer $service
            $health = if ($id) { Get-ContainerHealth $id } else { "missing" }
            if ($health -eq "healthy") {
                Write-Status "$service is healthy" "OK"
                [void]$pending.Remove($service)
            } elseif ($health -in @("unhealthy", "exited", "dead")) {
                Write-Status "$service is $health" "ERROR"
                return $false
            }
        }
        if ($pending.Count -eq 0) { break }
        if ((Get-Date) -gt $deadline) {
            Write-Status "Timed out waiting for: $($pending -join ', ')" "ERROR"
            return $false
        }
        Start-Sleep -Seconds 3
    }

    # Healthy only means tailscaled is up; wait for it to be on the tailnet.
    while ($true) {
        $tailnet = Get-TailnetState
        if ($tailnet -and $tailnet.BackendState -eq "Running" -and $tailnet.DnsName) { break }
        if ((Get-Date) -gt $deadline) {
            $state = if ($tailnet) { $tailnet.BackendState } else { "unknown" }
            Write-Status "Tailscale did not join the tailnet (state: $state). Check TS_AUTHKEY." "ERROR"
            return $false
        }
        Start-Sleep -Seconds 3
    }
    Write-Status "On the tailnet as https://$($tailnet.DnsName)" "OK"

    $expected = Get-EnvValue "TS_CERT_DOMAIN"
    if ($expected -and $expected -ne $tailnet.DnsName) {
        Write-Status "TS_CERT_DOMAIN is $expected but Tailscale named this node $($tailnet.DnsName)." "WARN"
        Write-Status "Remove the stale machine in the Tailscale admin console, or update TS_CERT_DOMAIN and the Google redirect URI." "WARN"
    }

    # End to end through Tailscale Serve -> nginx/backend. /api/v1/setup/status
    # also passes the REQUIRE_TAILSCALE guard, which /health is exempt from.
    # The first request can take a while: Tailscale issues the TLS certificate.
    $base = "https://$($tailnet.DnsName)"
    foreach ($path in @("/health", "/api/v1/setup/status")) {
        $reached = $false
        while (-not $reached) {
            try {
                $null = Invoke-WebRequest -Uri "$base$path" -UseBasicParsing -TimeoutSec 30
                $reached = $true
            } catch {
                if ((Get-Date) -gt $deadline) { break }
                Start-Sleep -Seconds 5
            }
        }
        if ($reached) {
            Write-Status "$base$path answers" "OK"
        } else {
            Write-Status "$base$path did not answer from this machine (is it on the tailnet?)" "WARN"
        }
    }
    return $true
}

function Save-PreviousImages {
    # Tag the images of a healthy running stack as :previous for -Rollback.
    foreach ($service in $builtImages.Keys) {
        $id = Get-ServiceContainer $service
        if (-not $id -or (Get-ContainerHealth $id) -ne "healthy") { continue }
        $image = Invoke-Docker inspect --format "{{.Image}}" $id
        if (-not $image) { continue }
        & docker tag "$image".Trim() "$($builtImages[$service]):previous"
        if ($LASTEXITCODE -ne 0) { throw "Could not tag the running $service image as :previous" }
        Write-Status "Kept the running $service image as $($builtImages[$service]):previous" "OK"
    }
}

function Backup-VaultDatabase {
    # Returns the backup path, or $null when there is no database yet.
    param([string]$Label = "backup")
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $name = "$Label-$(Get-Date -Format 'yyyyMMdd-HHmmss').db"
    $mount = "$((Resolve-Path $BackupDir).Path):/backups"

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker compose --file $composeFile --env-file $envFile run --rm --no-deps -T `
            --volume $mount backend python -m app.maintenance backup "/backups/$name" | Out-Host
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -eq 3) {
        Write-Status "No vault database yet; nothing to back up" "INFO"
        return $null
    }
    if ($code -ne 0) { throw "Backup failed (exit code $code)" }
    $path = Join-Path $BackupDir $name
    Write-Status "Backup written to $path" "OK"
    return $path
}

function Restore-VaultDatabase {
    param([string]$Source)
    $file = Get-Item -LiteralPath $Source
    $mount = "$($file.DirectoryName):/restore:ro"
    Invoke-Compose run --rm --no-deps -T --user root `
        --volume $mount backend python -m app.maintenance restore "/restore/$($file.Name)" | Out-Host
    Write-Status "Vault database replaced with $($file.FullName)" "OK"
}

function Show-Failure {
    Write-Status "Recent backend logs:" "INFO"
    try { Invoke-Compose logs --tail 40 backend } catch { Write-Status $_.Exception.Message "WARN" }
    Write-Host ""
    Write-Status "If an earlier version was running, return to it with: .\scripts\windows\Deploy-CredentialVault.ps1 -Rollback" "WARN"
}

function Show-StackStatus {
    foreach ($service in $services) {
        $id = Get-ServiceContainer $service
        $health = if ($id) { Get-ContainerHealth $id } else { "not created" }
        $type = if ($health -eq "healthy") { "OK" } else { "WARN" }
        Write-Status "$service`: $health" $type
    }
    $tailnet = Get-TailnetState
    if ($tailnet -and $tailnet.DnsName) {
        Write-Status "Tailnet: $($tailnet.BackendState), https://$($tailnet.DnsName)" "INFO"
    }
    foreach ($service in $builtImages.Keys) {
        $previousImage = Invoke-Docker image ls -q "$($builtImages[$service]):previous"
        if ($previousImage) { Write-Status "Rollback image available: $($builtImages[$service]):previous" "INFO" }
    }
    if (Test-Path $BackupDir) {
        $backups = Get-ChildItem $BackupDir -Filter *.db | Sort-Object LastWriteTime -Descending
        Write-Status "$(@($backups).Count) backup(s) in $BackupDir" "INFO"
        $backups | Select-Object -First 5 | ForEach-Object { Write-Host "    $($_.Name)" }
    }
}

# ── Actions ──────────────────────────────────────────────────────────────

Push-Location $repoRoot
try {
    switch ($PSCmdlet.ParameterSetName) {
        'Status' {
            Test-Prerequisites
            Show-StackStatus
        }

        'Stop' {
            Test-Prerequisites
            Invoke-Compose stop
            Write-Status "Stack stopped; it stays down until the next deploy" "OK"
        }

        'Backup' {
            Test-Prerequisites
            $null = Backup-VaultDatabase -Label "backup"
        }

        'Restore' {
            Test-Prerequisites -Start
            if (-not $PSCmdlet.ShouldProcess("vault database", "Replace with $Restore")) { return }
            Invoke-Compose stop backend
            $null = Backup-VaultDatabase -Label "pre-restore"
            Restore-VaultDatabase -Source $Restore
            Invoke-Compose up -d
            if (-not (Wait-StackHealthy)) { Show-Failure; exit 1 }
        }

        'Rollback' {
            Test-Prerequisites -Start
            $tag = Get-ImageTag
            foreach ($service in $builtImages.Keys) {
                if (-not (Invoke-Docker image ls -q "$($builtImages[$service]):previous")) {
                    throw "No $($builtImages[$service]):previous image; there is no earlier deploy to return to."
                }
            }
            $snapshot = $null
            if (Test-Path $BackupDir) {
                $snapshot = Get-ChildItem $BackupDir -Filter "pre-deploy-*.db" |
                    Sort-Object Name -Descending | Select-Object -First 1
            }
            $what = "Return to the :previous images"
            if ($snapshot) { $what += " and restore $($snapshot.Name) (changes since that deploy are lost)" }
            if (-not $PSCmdlet.ShouldProcess("Credential Vault stack", $what)) { return }

            Invoke-Compose stop backend
            if ($snapshot) {
                $null = Backup-VaultDatabase -Label "pre-rollback"
                Restore-VaultDatabase -Source $snapshot.FullName
            }
            foreach ($service in $builtImages.Keys) {
                & docker tag "$($builtImages[$service]):previous" "$($builtImages[$service]):$tag"
                if ($LASTEXITCODE -ne 0) { throw "Could not restore the $service image" }
            }
            Invoke-Compose up -d --no-build
            if (-not (Wait-StackHealthy)) { Show-Failure; exit 1 }
            Write-Status "Rolled back" "OK"
        }

        default {
            Test-Prerequisites -Start
            Save-PreviousImages
            Write-Status "Building images..." "INFO"
            Invoke-Compose build --pull
            # Stop the backend so the backup is a consistent snapshot taken
            # before the new image runs its migrations.
            Invoke-Compose stop backend
            $null = Backup-VaultDatabase -Label "pre-deploy"
            Invoke-Compose up -d --no-build --remove-orphans
            if (-not (Wait-StackHealthy)) { Show-Failure; exit 1 }
            Write-Status "Deployed. Docker restarts the stack on boot; no dev servers needed." "OK"
        }
    }
} finally {
    Pop-Location
}
