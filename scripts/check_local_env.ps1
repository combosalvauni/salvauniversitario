$ErrorActionPreference = 'Stop'

$envPath = Join-Path (Get-Location) '.env'
if (-not (Test-Path $envPath)) {
  Write-Output 'Arquivo .env não encontrado na raiz do projeto.'
  exit 1
}

$required = @(
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY'
)

$lines = Get-Content $envPath | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
$map = @{}
foreach ($line in $lines) {
  $parts = $line -split '=', 2
  if ($parts.Count -lt 2) { continue }
  $name = $parts[0].Trim()
  $value = $parts[1]
  $map[$name] = $value
}

$missing = @()
foreach ($key in $required) {
  if (-not $map.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($map[$key])) {
    $missing += $key
  }
}

if ($missing.Count -gt 0) {
  Write-Output 'Variáveis obrigatórias ausentes ou vazias no .env:'
  $missing | ForEach-Object { Write-Output "- $_" }
  Write-Output ''
  Write-Output 'Preencha no .env com dados do projeto Supabase e rode novamente.'
  exit 1
}

Write-Output 'OK: variáveis principais do .env estão preenchidas.'
exit 0
