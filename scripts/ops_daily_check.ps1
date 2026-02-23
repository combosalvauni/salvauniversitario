param(
  [string]$ApiBase = 'https://api.combosalvauniversitario.site'
)

$ErrorActionPreference = 'Stop'

function Write-Check($name, $ok, $detail) {
  $status = if ($ok) { 'OK' } else { 'FAIL' }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1} - {2}" -f $status, $name, $detail) -ForegroundColor $color
}

function Read-ErrorBody($err) {
  try {
    $reader = New-Object System.IO.StreamReader($err.Exception.Response.GetResponseStream())
    return $reader.ReadToEnd()
  } catch {
    return $err.Exception.Message
  }
}

$allOk = $true

Write-Host "== OPS DAILY CHECK ==" -ForegroundColor Cyan
Write-Host "API: $ApiBase" -ForegroundColor DarkCyan
Write-Host ""

# 1) Health
try {
  $health = Invoke-RestMethod -Uri "$ApiBase/health" -Method Get
  $healthOk = $health.ok -eq $true -and $health.configured -eq $true -and $health.supabaseConfigured -eq $true -and $health.webhookTokenConfigured -eq $true
  Write-Check 'Health' $healthOk ("ok={0}, configured={1}, supabase={2}, webhookToken={3}" -f $health.ok, $health.configured, $health.supabaseConfigured, $health.webhookTokenConfigured)
  if (-not $healthOk) { $allOk = $false }
} catch {
  $allOk = $false
  Write-Check 'Health' $false (Read-ErrorBody $_)
}

# 2) Public checkout forged amount (must be server-forced)
$randomA = Get-Random
$bodyValid = @{
  offerName = 'Combo mensal'
  amountCents = 1
  customer = @{
    name = 'Ops Check'
    email = "ops.valid.$randomA@example.com"
    phone = '11999999999'
  }
} | ConvertTo-Json -Depth 6

try {
  $validRes = Invoke-RestMethod -Uri "$ApiBase/api/public/first-offer/checkout" -Method Post -ContentType 'application/json' -Body $bodyValid
  $amountCandidates = @(
    [int]($validRes.amountCents),
    [int]($validRes.amount),
    [int]($validRes.raw.amount),
    [int]($validRes.raw.total_amount_cents)
  ) | Where-Object { $_ -gt 0 }

  $amount = if ($amountCandidates.Count -gt 0) { $amountCandidates[0] } else { 0 }
  $validOk = $validRes.ok -eq $true -and $amount -eq 3990
  Write-Check 'Checkout forged amount' $validOk ("returnedAmount={0}" -f $amount)
  if (-not $validOk) { $allOk = $false }
} catch {
  $allOk = $false
  Write-Check 'Checkout forged amount' $false (Read-ErrorBody $_)
}

# 3) Public checkout invalid offer (must return 400)
$randomB = Get-Random
$bodyInvalid = @{
  offerName = 'Plano hacker'
  amountCents = 1
  customer = @{
    name = 'Ops Check'
    email = "ops.invalid.$randomB@example.com"
    phone = '11999999999'
  }
} | ConvertTo-Json -Depth 6

try {
  $null = Invoke-WebRequest -Uri "$ApiBase/api/public/first-offer/checkout" -Method Post -ContentType 'application/json' -Body $bodyInvalid -UseBasicParsing
  $allOk = $false
  Write-Check 'Checkout invalid offer' $false 'Expected 400, received success response'
} catch {
  $code = 0
  try { $code = [int]$_.Exception.Response.StatusCode } catch {}
  $errBody = Read-ErrorBody $_
  $invalidOk = $code -eq 400
  Write-Check 'Checkout invalid offer' $invalidOk ("status={0}, body={1}" -f $code, $errBody)
  if (-not $invalidOk) { $allOk = $false }
}

Write-Host ""
if ($allOk) {
  Write-Host 'RESULT: ALL CHECKS PASSED' -ForegroundColor Green
  exit 0
}

Write-Host 'RESULT: ONE OR MORE CHECKS FAILED' -ForegroundColor Red
exit 1
