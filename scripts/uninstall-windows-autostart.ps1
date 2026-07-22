param(
  [switch]$KeepHosts
)

$ErrorActionPreference = "Stop"
$taskName = "DevHub Node"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  if ($KeepHosts) { $arguments += " -KeepHosts" }
  Write-Host "Zum Entfernen von Aufgabenplanung und Hosts-Eintrag wird eine UAC-Bestätigung benötigt."
  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

if (-not $KeepHosts) {
  $hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
  $existingLines = [IO.File]::ReadAllLines($hostsPath)
  [string[]]$updatedLines = @($existingLines | Where-Object { $_ -notmatch "# DevHub Node \(managed\)\s*$" })
  [IO.File]::WriteAllLines($hostsPath, $updatedLines, [Text.UTF8Encoding]::new($false))
  & ipconfig.exe /flushdns | Out-Null
}

Write-Host "DevHub-Autostart wurde entfernt." -ForegroundColor Green
Write-Host "Ein bereits laufender DevHub-Prozess wird dadurch nicht beendet."
