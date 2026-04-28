param(
  [string]$UnlockToken = $env:UNLOCK_TOKEN,
  [string]$BaseUrl = $(if (-not [string]::IsNullOrWhiteSpace($env:BASE_URL)) { $env:BASE_URL } else { 'https://ght.vexom.io' }),
  [string]$OutDir = $(Join-Path $PSScriptRoot '..\backups')
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($UnlockToken)) {
  Write-Host "Usage: `$env:UNLOCK_TOKEN='your-token'; .\backup.ps1"
  exit 1
}

$sha = [System.Security.Cryptography.SHA256]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($UnlockToken)
$hash = $sha.ComputeHash($bytes)
$htok = ($hash | ForEach-Object { $_.ToString('x2') }) -join ''

$cookieJar = New-Object System.Net.CookieContainer
$uri = [Uri]$BaseUrl
$cookieJar.Add((New-Object System.Net.Cookie('htok', $htok, '/', $uri.Host)))

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.Cookies = $cookieJar

Write-Host "Fetching $BaseUrl/api/cycles ..."
$cycles = Invoke-RestMethod -Uri "$BaseUrl/api/cycles" -WebSession $session -Method Get

Write-Host "Fetching $BaseUrl/api/entries ..."
$entries = Invoke-RestMethod -Uri "$BaseUrl/api/entries" -WebSession $session -Method Get

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $OutDir "habit-tracker-$stamp.json"
$payload = [ordered]@{
  exportedAt  = (Get-Date).ToString('o')
  cycles      = $cycles.cycles
  entryBounds = $cycles.entryBounds
  entries     = $entries.entries
}
$payload | ConvertTo-Json -Depth 32 | Out-File -FilePath $file -Encoding utf8

$cycleCount = ($cycles.cycles | Measure-Object).Count
$entryCount = ($entries.entries.PSObject.Properties | Measure-Object).Count
Write-Host "Saved $file"
Write-Host "  cycles : $cycleCount"
Write-Host "  entries: $entryCount"
