[CmdletBinding()]
param(
  [ValidateSet('Status', 'Sync', 'Deploy')]
  [string]$Mode = 'Status',

  [ValidateSet('Homepage', 'CheckoutAll', 'Backend', 'VpsEnv')]
  [string]$Profile = 'Homepage',

  [string]$SshHost = 'root@69.62.90.16',
  [string]$KeyPath = 'C:\Users\vboxuser\.ssh\appsalva_prod_ed25519',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-AbsolutePath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }

  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $PathValue))
}

function Get-LocalFileInfo([string]$PathValue) {
  if (-not (Test-Path $PathValue -PathType Leaf)) {
    return $null
  }

  $item = Get-Item $PathValue
  $hash = (Get-FileHash -Path $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

  return [pscustomobject]@{
    Path = $item.FullName
    Size = $item.Length
    LastWriteTime = $item.LastWriteTime
    Hash = $hash
  }
}

function Get-RemoteFileInfo([string]$RemoteHost, [string]$SshKey, [string]$RemotePath) {
  $remoteCommand = "if [ ! -f '$RemotePath' ]; then echo '__MISSING__'; exit 3; fi; sha256sum '$RemotePath' | cut -d ' ' -f1; stat -c '%s|%Y|%a|%u|%g' '$RemotePath'"
  $output = & ssh -i $SshKey $RemoteHost $remoteCommand 2>&1
  $exitCode = $LASTEXITCODE
  $lines = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })

  if ($exitCode -eq 3 -or ($lines -contains '__MISSING__')) {
    throw "Arquivo remoto nao existe: $RemotePath"
  }

  if ($exitCode -ne 0) {
    throw "Falha ao ler arquivo remoto.`n$($lines -join "`n")"
  }

  $hashLine = $lines | Where-Object { $_ -match '^[0-9a-fA-F]{64}$' } | Select-Object -First 1
  $statLine = $lines | Where-Object { $_ -match '^\d+\|\d+\|\d+\|\d+\|\d+$' } | Select-Object -First 1

  if (-not $hashLine -or -not $statLine) {
    throw "Resposta remota inesperada.`n$($lines -join "`n")"
  }

  $parts = $statLine.Split('|', 5)
  $timestamp = [DateTimeOffset]::FromUnixTimeSeconds([int64]$parts[1]).ToLocalTime().DateTime

  return [pscustomobject]@{
    Host = $RemoteHost
    Path = $RemotePath
    Size = [int64]$parts[0]
    LastWriteTime = $timestamp
    Permissions = $parts[2]
    OwnerId = $parts[3]
    GroupId = $parts[4]
    Hash = $hashLine.ToLowerInvariant()
  }
}

function Write-FileSummary([string]$Label, $Info) {
  Write-Host "[$Label]"
  Write-Host "  Path: $($Info.Path)"
  Write-Host "  Size: $($Info.Size) bytes"
  Write-Host "  Modified: $($Info.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"
  Write-Host "  SHA256: $($Info.Hash)"
}

function Assert-ToolExists([string]$Name) {
  $tool = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $tool) {
    throw "Ferramenta obrigatoria ausente: $Name"
  }
}

function Validate-EnvFile([string]$PathValue, [string[]]$RequiredKeys) {
  $lines = Get-Content -Path $PathValue
  $seen = @{}
  $parsed = @{}

  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    if ($trimmed -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') {
      throw "Arquivo .env invalido: linha fora do formato KEY=value -> $trimmed"
    }

    $parts = $trimmed -split '=', 2
    $key = $parts[0].Trim()
    $value = $parts[1]

    if ($seen.ContainsKey($key)) {
      throw "Arquivo .env invalido: chave duplicada -> $key"
    }

    $seen[$key] = $true
    $parsed[$key] = $value
  }

  foreach ($requiredKey in $RequiredKeys) {
    if (-not $parsed.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace($parsed[$requiredKey])) {
      throw "Arquivo .env invalido: chave obrigatoria ausente ou vazia -> $requiredKey"
    }
  }
}

function Get-ProfileConfig([string]$ProfileName) {
  switch ($ProfileName) {
    'Homepage' {
      return @{
        Files = @(
          @{ Label = 'Homepage'; LocalFile = '.\index\index.html'; RemoteFile = '/var/www/concursaflix/index/index.html'; TempPrefix = 'homepage_index' }
        )
        ProtectMessage = 'landing de producao'
        SyncHint = 'npm run homepage:sync'
        ForceHint = 'npm run homepage:deploy:force'
      }
    }
    'CheckoutAll' {
      return @{
        Files = @(
          @{ Label = 'Checkout Mensal HTML'; LocalFile = '.\checkout-mensal\index.html'; RemoteFile = '/var/www/concursaflix/checkout-mensal/index.html'; TempPrefix = 'checkout_mensal_index' }
          @{ Label = 'Checkout Mensal Script'; LocalFile = '.\checkout-mensal\script.js'; RemoteFile = '/var/www/concursaflix/checkout-mensal/script.js'; TempPrefix = 'checkout_mensal_script' }
          @{ Label = 'Checkout Mensal Styles'; LocalFile = '.\checkout-mensal\styles.css'; RemoteFile = '/var/www/concursaflix/checkout-mensal/styles.css'; TempPrefix = 'checkout_mensal_styles' }
          @{ Label = 'Checkout Trimestral HTML'; LocalFile = '.\checkout-trimestral\index.html'; RemoteFile = '/var/www/concursaflix/checkout-trimestral/index.html'; TempPrefix = 'checkout_trimestral_index' }
          @{ Label = 'Checkout Trimestral Script'; LocalFile = '.\checkout-trimestral\script.js'; RemoteFile = '/var/www/concursaflix/checkout-trimestral/script.js'; TempPrefix = 'checkout_trimestral_script' }
          @{ Label = 'Checkout Trimestral Styles'; LocalFile = '.\checkout-trimestral\styles.css'; RemoteFile = '/var/www/concursaflix/checkout-trimestral/styles.css'; TempPrefix = 'checkout_trimestral_styles' }
          @{ Label = 'Checkout Semestral HTML'; LocalFile = '.\checkout-semestral\index.html'; RemoteFile = '/var/www/concursaflix/checkout-semestral/index.html'; TempPrefix = 'checkout_semestral_index' }
          @{ Label = 'Checkout Semestral Script'; LocalFile = '.\checkout-semestral\script.js'; RemoteFile = '/var/www/concursaflix/checkout-semestral/script.js'; TempPrefix = 'checkout_semestral_script' }
          @{ Label = 'Checkout Semestral Styles'; LocalFile = '.\checkout-semestral\styles.css'; RemoteFile = '/var/www/concursaflix/checkout-semestral/styles.css'; TempPrefix = 'checkout_semestral_styles' }
        )
        ProtectMessage = 'checkouts de producao'
        SyncHint = 'npm run checkout:sync'
        ForceHint = 'npm run checkout:deploy:force'
      }
    }
    'Backend' {
      return @{
        Files = @(
          @{ Label = 'Backend Proxy'; LocalFile = '.\server\babylonProxy.mjs'; RemoteFile = '/var/www/concursaflix/server/babylonProxy.mjs'; TempPrefix = 'babylon_proxy' }
        )
        ProtectMessage = 'backend de producao'
        SyncHint = 'npm run backend:sync'
        ForceHint = 'npm run backend:deploy:force'
        AfterDeployCommand = 'set -e; systemctl restart babylon-proxy; systemctl is-active babylon-proxy'
      }
    }
    'VpsEnv' {
      return @{
        Files = @(
          @{ Label = 'VPS Env'; LocalFile = '.\.env.vps'; RemoteFile = '/var/www/concursaflix/.env'; TempPrefix = 'backend_env'; ValidateKind = 'Env' }
        )
        ProtectMessage = 'arquivo .env de producao'
        SyncHint = 'npm run env:vps:sync'
        ForceHint = 'npm run env:vps:deploy:force'
        AfterDeployCommand = 'set -e; systemctl restart babylon-proxy; systemctl is-active babylon-proxy'
        RequiredEnvKeys = @('BABYLON_PROXY_PORT', 'BABYLON_ALLOWED_ORIGINS', 'NODE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_APP_URL', 'WHATSAPP_ENABLED', 'META_PIXEL_ID')
      }
    }
  }

  throw "Profile desconhecido: $ProfileName"
}

Assert-ToolExists 'ssh'
Assert-ToolExists 'scp'

$resolvedKeyPath = Get-AbsolutePath $KeyPath
if (-not (Test-Path $resolvedKeyPath -PathType Leaf)) {
  throw "Chave SSH nao encontrada: $resolvedKeyPath"
}

$profileConfig = Get-ProfileConfig $Profile
$entries = @()

foreach ($fileSpec in $profileConfig.Files) {
  $resolvedLocalFile = Get-AbsolutePath $fileSpec.LocalFile
  $resolvedLocalDirectory = Split-Path -Parent $resolvedLocalFile
  if (-not (Test-Path $resolvedLocalDirectory -PathType Container)) {
    throw "Diretorio local nao encontrado: $resolvedLocalDirectory"
  }

  $remoteInfo = Get-RemoteFileInfo -RemoteHost $SshHost -SshKey $resolvedKeyPath -RemotePath $fileSpec.RemoteFile
  $localInfo = Get-LocalFileInfo -PathValue $resolvedLocalFile

  $entries += [pscustomobject]@{
    Spec = $fileSpec
    LocalPath = $resolvedLocalFile
    RemoteInfo = $remoteInfo
    LocalInfo = $localInfo
    IsDifferent = (-not $localInfo -or $localInfo.Hash -ne $remoteInfo.Hash)
  }
}

foreach ($entry in $entries) {
  Write-Host "=== $($entry.Spec.Label) ==="
  Write-FileSummary -Label 'REMOTE' -Info $entry.RemoteInfo
  if ($entry.LocalInfo) {
    Write-FileSummary -Label 'LOCAL' -Info $entry.LocalInfo
  } else {
    Write-Host '[LOCAL]'
    Write-Host "  Path: $($entry.LocalPath)"
    Write-Host '  Status: arquivo local ausente'
  }
  Write-Host "[STATUS] Divergencia local/remoto: $(if ($entry.IsDifferent) { 'SIM' } else { 'NAO' })"
  Write-Host ''
}

$hasDifferences = $entries | Where-Object { $_.IsDifferent } | Select-Object -First 1

switch ($Mode) {
  'Status' {
    if ($hasDifferences) {
      Write-Host "Acao recomendada: rode $($profileConfig.SyncHint) antes de editar ou publicar."
    } else {
      Write-Host 'Local e VPS estao sincronizados.'
    }
    exit 0
  }

  'Sync' {
    foreach ($entry in $entries) {
      if (-not $entry.IsDifferent) {
        Write-Host "Sync ignorado para $($entry.Spec.Label): local ja esta igual ao remoto."
        continue
      }

      if ($entry.LocalInfo) {
        $backupPath = "$($entry.LocalPath).bak_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item -Path $entry.LocalPath -Destination $backupPath -Force
        Write-Host "Backup local criado: $backupPath"
      }

      & scp -i $resolvedKeyPath "${SshHost}:$($entry.Spec.RemoteFile)" $entry.LocalPath
      if ($LASTEXITCODE -ne 0) {
        throw "Falha ao baixar o arquivo remoto: $($entry.Spec.Label)"
      }

      $syncedLocalInfo = Get-LocalFileInfo -PathValue $entry.LocalPath
      if (-not $syncedLocalInfo -or $syncedLocalInfo.Hash -ne $entry.RemoteInfo.Hash) {
        throw "Sync concluido, mas a verificacao de hash falhou: $($entry.Spec.Label)"
      }

      Write-Host "Sync concluido: $($entry.Spec.Label)"
    }

    Write-Host 'Sync finalizado.'
    exit 0
  }

  'Deploy' {
    foreach ($entry in $entries) {
      if (-not $entry.LocalInfo) {
        throw "Arquivo local nao encontrado: $($entry.LocalPath)"
      }
    }

    if (-not $hasDifferences) {
      Write-Host 'Deploy ignorado: todos os arquivos locais ja sao iguais aos da VPS.'
      exit 0
    }

    if (-not $Force) {
      Write-Host 'Deploy bloqueado: ha divergencia entre local e remoto.'
      Write-Host "Isso evita sobrescrever $($profileConfig.ProtectMessage) com uma copia local desatualizada."
      Write-Host "Use primeiro: $($profileConfig.SyncHint)"
      Write-Host "Se a divergencia for intencional, rode: $($profileConfig.ForceHint)"
      exit 2
    }

    if ($profileConfig.ContainsKey('RequiredEnvKeys')) {
      foreach ($entry in $entries) {
        if ($entry.Spec.ValidateKind -eq 'Env') {
          Validate-EnvFile -PathValue $entry.LocalPath -RequiredKeys $profileConfig.RequiredEnvKeys
          Write-Host "Validacao OK: $($entry.Spec.Label)"
        }
      }
    }

    $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'

    foreach ($entry in ($entries | Where-Object { $_.IsDifferent })) {
      $remoteBackup = "$($entry.Spec.RemoteFile).bak_safe_$timestamp"
      $tempRemote = "/tmp/$($entry.Spec.TempPrefix)_$timestamp.tmp"

      & scp -i $resolvedKeyPath $entry.LocalPath "${SshHost}:$tempRemote"
      if ($LASTEXITCODE -ne 0) {
        throw "Falha ao enviar arquivo temporario para a VPS: $($entry.Spec.Label)"
      }

      $applyCommand = "set -e; cp '$($entry.Spec.RemoteFile)' '$remoteBackup'; install -o $($entry.RemoteInfo.OwnerId) -g $($entry.RemoteInfo.GroupId) -m $($entry.RemoteInfo.Permissions) '$tempRemote' '$($entry.Spec.RemoteFile)'; rm -f '$tempRemote'; sha256sum '$($entry.Spec.RemoteFile)' | cut -d ' ' -f1"
      $applyOutput = & ssh -i $resolvedKeyPath $SshHost $applyCommand 2>&1
      $applyExitCode = $LASTEXITCODE
      $applyLines = @($applyOutput | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })

      if ($applyExitCode -ne 0) {
        throw "Falha ao aplicar o deploy na VPS: $($entry.Spec.Label)`n$($applyLines -join "`n")"
      }

      $remoteHashAfterDeploy = $applyLines | Where-Object { $_ -match '^[0-9a-fA-F]{64}$' } | Select-Object -Last 1
      if (-not $remoteHashAfterDeploy -or $remoteHashAfterDeploy.ToLowerInvariant() -ne $entry.LocalInfo.Hash) {
        throw "Deploy concluido, mas a verificacao final de hash falhou: $($entry.Spec.Label)"
      }

      Write-Host "Deploy OK: $($entry.Spec.Label) | backup remoto: $remoteBackup"
    }

    if ($profileConfig.ContainsKey('AfterDeployCommand')) {
      $afterOutput = & ssh -i $resolvedKeyPath $SshHost $profileConfig.AfterDeployCommand 2>&1
      $afterExitCode = $LASTEXITCODE
      $afterLines = @($afterOutput | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })

      if ($afterExitCode -ne 0) {
        throw "Falha na etapa pos-deploy.`n$($afterLines -join "`n")"
      }

      if ($afterLines.Count -gt 0) {
        Write-Host ($afterLines -join "`n")
      }
    }

    Write-Host 'Deploy finalizado com sucesso.'
    exit 0
  }
}