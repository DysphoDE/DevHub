param(
  [string]$Hostname = "",
  [string]$Mode = "",
  [switch]$SkipHosts,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$taskName = "DevHub Node"
$hostsMarker = "# DevHub Node (managed)"
$appRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $appRoot "devhub.config.json"
$startScript = Join-Path $PSScriptRoot "start-devhub.ps1"
$hiddenLauncher = Join-Path $PSScriptRoot "start-devhub-hidden.vbs"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $standardPath = Join-Path $env:ProgramFiles "nodejs\node.exe"
  if (Test-Path -LiteralPath $standardPath -PathType Leaf) {
    return $standardPath
  }

  $laragonNode = Get-ChildItem -LiteralPath "C:\laragon\bin\nodejs" -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($laragonNode) {
    return $laragonNode.FullName
  }

  throw "Node.js wurde nicht gefunden. Installiere Node.js und starte die Installation erneut."
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Konfiguration fehlt: $configPath"
}
if (-not (Test-Path -LiteralPath $startScript -PathType Leaf) -or -not (Test-Path -LiteralPath $hiddenLauncher -PathType Leaf)) {
  throw "Die Windows-Autostartskripte sind unvollständig."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $Mode) {
  $Mode = [string]$config.autostartMode
}
if (-not $Mode) {
  $Mode = "dev"
}
$Mode = $Mode.ToLowerInvariant()
if ($Mode -notin @("dev", "production")) {
  throw "Ungültiger DevHub-Autostart-Modus: $Mode"
}

if (-not $Hostname) {
  $Hostname = [string]$config.publicHost
}
if (-not $Hostname) {
  $Hostname = "devhub"
}
if ($Hostname -notmatch "^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$") {
  throw "Ungültiger lokaler Hostname: $Hostname"
}
$Hostname = $Hostname.ToLowerInvariant()

if (-not (Test-IsAdministrator)) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Hostname `"$Hostname`" -Mode `"$Mode`""
  if ($SkipHosts) { $arguments += " -SkipHosts" }
  if ($NoStart) { $arguments += " -NoStart" }
  Write-Host "Für Hosts-Datei und Aufgabenplanung wird einmalig eine UAC-Bestätigung benötigt."
  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

$requiredRuntime = if ($Mode -eq "dev") {
  Join-Path $appRoot "node_modules\tsx\dist\cli.mjs"
} else {
  Join-Path $appRoot "dist\server.js"
}
if (-not (Test-Path -LiteralPath $requiredRuntime -PathType Leaf)) {
  $preparation = if ($Mode -eq "dev") { "npm install" } else { "npm run build" }
  throw "Die Laufzeit für den Modus '$Mode' fehlt. Führe in $appRoot zuerst '$preparation' aus."
}

$nodePath = Resolve-NodeExecutable
$port = [int]$config.port
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$actionArguments = "//B //Nologo `"$hiddenLauncher`" `"$nodePath`" `"$Mode`""
$action = New-ScheduledTaskAction -Execute $wscriptPath -Argument $actionArguments -WorkingDirectory $appRoot
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$watchdogTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)
$triggers = @($logonTrigger, $watchdogTrigger)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description "Startet DevHub beim Windows-Login unsichtbar im Modus '$Mode' und stellt den Prozess bei einem Ausfall wieder her."
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

if (-not $SkipHosts) {
  $hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
  $existingLines = [IO.File]::ReadAllLines($hostsPath)
  [string[]]$updatedLines = @($existingLines | Where-Object { $_ -notmatch "# DevHub Node \(managed\)\s*$" })
  $updatedLines += "127.0.0.1`t$Hostname`t$hostsMarker"
  [IO.File]::WriteAllLines($hostsPath, $updatedLines, [Text.UTF8Encoding]::new($false))
  & ipconfig.exe /flushdns | Out-Null
}

if (-not $NoStart) {
  Start-ScheduledTask -TaskName $taskName
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/bootstrap" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) {
    Write-Warning "Die Aufgabe wurde installiert, DevHub antwortet aber noch nicht. Prüfe .devhub\autostart.log."
  }
}

Write-Host ""
Write-Host "DevHub-Autostart wurde installiert." -ForegroundColor Green
Write-Host "Adresse: http://${Hostname}:$port"
Write-Host "Modus: $Mode"
Write-Host "Aufgabe: $taskName (Benutzer $userId)"
Write-Host "Log: $(Join-Path $appRoot '.devhub\autostart.log')"
