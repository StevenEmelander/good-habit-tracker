param(
  [Parameter(Mandatory = $false)]
  [string]$UnlockToken = $env:UNLOCK_TOKEN,
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = $(if (-not [string]::IsNullOrWhiteSpace($env:BASE_URL)) { $env:BASE_URL } else { 'https://ght.vexom.io' })
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnlockToken)) {
  Write-Host "Usage: `$env:UNLOCK_TOKEN='your-token'; .\deploy.ps1"
  Write-Host "   or: .\deploy.ps1 -UnlockToken 'your-token'"
  exit 1
}

$infraDir = Join-Path $PSScriptRoot "infrastructure"
if (-not (Test-Path $infraDir)) {
  Write-Host "Could not find infrastructure directory at: $infraDir"
  exit 1
}

Push-Location $infraDir
try {
  Write-Host "Installing dependencies..."
  npm install

  Write-Host "Deploying stack..."
  npx cdk deploy --all --require-approval never --context "unlock_token=$UnlockToken"

  $enc = [System.Uri]::EscapeDataString($UnlockToken)
  Write-Host ""
  Write-Host "Done. Unlock (bookmark this URL): ${BaseUrl}/?unlock=${enc}"
}
finally {
  Pop-Location
}
