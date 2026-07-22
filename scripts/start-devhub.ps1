param(
  [string]$NodePath = "",
  [string]$Mode = ""
)

$ErrorActionPreference = "Stop"
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$appRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $appRoot "devhub.config.json"
$serverPath = Join-Path $appRoot "dist\server.js"
$sourcePath = Join-Path $appRoot "src\server.ts"
$tsxPath = Join-Path $appRoot "node_modules\tsx\dist\cli.mjs"
$stateDirectory = Join-Path $appRoot ".devhub"
$logPath = Join-Path $stateDirectory "autostart.log"

function Resolve-NodeExecutable {
  param([string]$PreferredPath)

  if ($PreferredPath -and (Test-Path -LiteralPath $PreferredPath -PathType Leaf)) {
    return (Resolve-Path -LiteralPath $PreferredPath).Path
  }

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

  throw "Node.js wurde nicht gefunden. Installiere Node.js oder übergib -NodePath."
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Konfiguration fehlt: $configPath"
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

$port = [int]$config.port
$appRootPattern = [Regex]::Escape($appRoot)
$existingDevHub = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -match $appRootPattern -and
    $_.CommandLine -match "(?:src[\\/]server\.ts|dist[\\/]server\.js)"
  } |
  Select-Object -First 1
if ($existingDevHub) {
  exit 0
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  exit 0
}

$resolvedNodePath = Resolve-NodeExecutable -PreferredPath $NodePath
if ($Mode -eq "dev") {
  if (-not (Test-Path -LiteralPath $tsxPath -PathType Leaf)) {
    throw "Der Dev-Watcher fehlt. Führe in $appRoot zuerst 'npm install' aus."
  }
  $runtimeArguments = @($tsxPath, "watch", $sourcePath)
} else {
  if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Der Produktions-Build fehlt. Führe in $appRoot zuerst 'npm run build' aus."
  }
  $runtimeArguments = @($serverPath)
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Set-Location -LiteralPath $appRoot

"[$(Get-Date -Format o)] DevHub-Autostart ($Mode) mit $resolvedNodePath" | Add-Content -LiteralPath $logPath -Encoding UTF8
& $resolvedNodePath @runtimeArguments 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding UTF8
$exitCode = $LASTEXITCODE
"[$(Get-Date -Format o)] DevHub wurde mit Exit-Code $exitCode beendet." | Add-Content -LiteralPath $logPath -Encoding UTF8
exit $exitCode
