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

    Without parameters, deploys the latest CI release: the images the CI
    publish job pushed to GHCR for the newest main commit. Their digests are
    read from that commit's release/* statuses through the GitHub API, the
    images are pulled by digest and must carry the matching revision label.
    Then: stop the backend, back up the database, start the stack and wait for
    the health checks. -Build does the same with images built from this
    checkout instead.

.PARAMETER Tag
    Which CI release to deploy: "latest" (default) or a commit SHA. Needs the
    GitHub CLI (gh auth login) and a one-time "docker login ghcr.io".

.PARAMETER Build
    Build the images from this checkout instead of pulling a CI release.

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
    Deploy (or update to) the latest CI release.

.EXAMPLE
    .\Deploy-CredentialVault.ps1 -Tag 0e255ed
    Deploy the CI release built from that commit.

.EXAMPLE
    .\Deploy-CredentialVault.ps1 -Build
    Build from this checkout and deploy.

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
    [Parameter(ParameterSetName = 'Deploy')]
    [string]$Tag = "latest",

    [Parameter(ParameterSetName = 'Build', Mandatory = $true)]
    [switch]$Build,

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

function Invoke-Gh {
    # gh without throwing; stderr is dropped. Returns stdout lines.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & gh @args 2>$null
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

    # TS_AUTHKEY is optional: left empty, the sidecar asks for a browser login
    # (Wait-StackHealthy prints the URL), so no key has to be stored anywhere.
    # Either way the node identity then lives in the tailscale_state volume.
    $authKey = Get-EnvValue "TS_AUTHKEY"
    if ($authKey -match "^tskey-auth-x+") {
        throw "TS_AUTHKEY in .env.production is still the example value. Leave it empty (TS_AUTHKEY=) to log in through the browser, or set a real auth key."
    }
    $null = Invoke-Docker volume inspect $stateVolume
    if (-not $authKey -and $LASTEXITCODE -ne 0) {
        Write-Status "No TS_AUTHKEY: Tailscale will print a login URL to open in your browser" "INFO"
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
        AuthUrl      = "$(Get-JsonProperty $state 'AuthURL')"
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
    $loginShown = $false
    while ($true) {
        $tailnet = Get-TailnetState
        if ($tailnet -and $tailnet.BackendState -eq "Running" -and $tailnet.DnsName) { break }
        if ($tailnet -and $tailnet.BackendState -eq "NeedsLogin" -and $tailnet.AuthUrl -and -not $loginShown) {
            Write-Status "Add the vault to your tailnet: open $($tailnet.AuthUrl) and approve it (waiting up to 10 minutes)" "WARN"
            $loginShown = $true
            $deadline = (Get-Date).AddMinutes(10)
        }
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

function Get-ImageRevision {
    # The org.opencontainers.image.revision label (commit SHA), or "".
    param([string]$Image)
    $json = Invoke-Docker image inspect --format "{{json .Config.Labels}}" $Image
    if (-not $json) { return "" }
    $labels = ($json -join "") | ConvertFrom-Json
    return "$(Get-JsonProperty $labels 'org.opencontainers.image.revision')"
}

function Get-CheckoutRevision {
    # Commit of this checkout for the label on -Build images; -dirty marks
    # uncommitted changes.
    $sha = "$(& git -C $repoRoot rev-parse HEAD 2>$null)".Trim()
    if (-not $sha) { return "unknown" }
    if (& git -C $repoRoot status --porcelain 2>$null) { return "$sha-dirty" }
    return $sha
}

function Get-ReleaseDigests {
    # Image digests the CI publish job recorded as commit statuses, or $null.
    param([string]$Repo, [string]$Sha)
    $json = Invoke-Gh api "repos/$Repo/commits/$Sha/status"
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $combined = ($json -join "`n") | ConvertFrom-Json
    $digests = @{}
    foreach ($status in @(Get-JsonProperty $combined "statuses")) {
        if ($null -eq $status -or $status.state -ne "success") { continue }
        if ("$($status.context)" -notmatch '^release/(backend|frontend)$') { continue }
        $service = $Matches[1]
        if ("$($status.description)" -match '^sha256:[0-9a-f]{64}$') { $digests[$service] = "$($status.description)" }
    }
    if ($digests.Count -eq 2) { return $digests }
    return $null
}

function Resolve-Release {
    # Find the CI release for -Tag ("latest" or a commit SHA) on GitHub.
    param([string]$Tag)
    $useBuild = "Or build from this checkout: .\scripts\windows\Deploy-CredentialVault.ps1 -Build"
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "The GitHub CLI (gh) is needed to look up CI releases. $useBuild"
    }
    $null = Invoke-Gh auth status
    if ($LASTEXITCODE -ne 0) { throw "The GitHub CLI is not logged in. Run: gh auth login. $useBuild" }
    $repo = "$(Invoke-Gh repo view --json nameWithOwner --jq .nameWithOwner)".Trim()
    if (-not $repo) { throw "Could not determine the GitHub repository of this checkout. $useBuild" }

    if ($Tag -eq "latest") {
        $shas = Invoke-Gh api "repos/$repo/commits?sha=main&per_page=30" --jq ".[].sha"
        foreach ($sha in @($shas)) {
            $sha = "$sha".Trim()
            if (-not $sha) { continue }
            $digests = Get-ReleaseDigests -Repo $repo -Sha $sha
            if ($digests) { return [pscustomobject]@{ Repo = $repo; Sha = $sha; Digests = $digests } }
        }
        throw "No CI release found on the last 30 commits of main (the CI publish job has not run yet). $useBuild"
    }

    if ($Tag -notmatch '^[0-9a-fA-F]{7,40}$') { throw "-Tag must be 'latest' or a commit SHA, got '$Tag'." }
    $sha = "$(Invoke-Gh api "repos/$repo/commits/$Tag" --jq .sha)".Trim()
    if (-not $sha) { throw "Commit $Tag was not found in $repo." }
    $digests = Get-ReleaseDigests -Repo $repo -Sha $sha
    if (-not $digests) { throw "Commit $Tag has no CI release (the publish job did not run or failed for it). $useBuild" }
    return [pscustomobject]@{ Repo = $repo; Sha = $sha; Digests = $digests }
}

function Import-ReleaseImages {
    # Pull a release by digest and refuse images not built from its commit.
    # Returns the pulled references; nothing is retagged yet.
    param($Release)
    $owner = $Release.Repo.Split("/")[0].ToLowerInvariant()
    $refs = @{}
    foreach ($service in $builtImages.Keys) {
        $ref = "ghcr.io/$owner/$($builtImages[$service])@$($Release.Digests[$service])"
        Write-Status "Pulling $ref" "INFO"
        & docker pull $ref | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "docker pull failed for $ref. First pull on this machine? Log in once with a classic personal access token that has only read:packages: docker login ghcr.io -u <github user>"
        }
        $revision = Get-ImageRevision $ref
        if ($revision -ne $Release.Sha) {
            throw "$ref was built from '$revision', expected $($Release.Sha). Refusing to deploy it."
        }
        $refs[$service] = $ref
    }
    return $refs
}

function Publish-Stack {
    # Shared tail of every deploy once the :<tag> images are in place.
    # Stop the backend so the backup is a consistent snapshot taken before
    # the new image runs its migrations.
    Invoke-Compose stop backend
    $null = Backup-VaultDatabase -Label "pre-deploy"
    Invoke-Compose up -d --no-build --remove-orphans
    if (-not (Wait-StackHealthy)) { Show-Failure; exit 1 }
    Write-Status "Deployed. Docker restarts the stack on boot; no dev servers needed." "OK"
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
        $revision = ""
        if ($id -and $builtImages.ContainsKey($service)) {
            $image = "$(Invoke-Docker inspect --format '{{.Image}}' $id)".Trim()
            if ($image) { $revision = Get-ImageRevision $image }
            if ($revision) { $revision = " (commit $revision)" }
        }
        Write-Status "$service`: $health$revision" $type
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

        'Build' {
            Test-Prerequisites -Start
            Save-PreviousImages
            $env:VAULT_REVISION = Get-CheckoutRevision
            Write-Status "Building images from this checkout ($env:VAULT_REVISION)..." "INFO"
            Invoke-Compose build --pull
            Publish-Stack
        }

        default {
            Test-Prerequisites -Start
            $release = Resolve-Release -Tag $Tag
            Write-Status "CI release: commit $($release.Sha) of $($release.Repo)" "INFO"
            $refs = Import-ReleaseImages $release
            Save-PreviousImages
            $imageTag = Get-ImageTag
            foreach ($service in $builtImages.Keys) {
                & docker tag $refs[$service] "$($builtImages[$service]):$imageTag"
                if ($LASTEXITCODE -ne 0) { throw "Could not tag the pulled $service image" }
            }
            Publish-Stack
        }
    }
} finally {
    Pop-Location
}
