[CmdletBinding()]
param(
  [ValidateSet('Status', 'Sync', 'Deploy')]
  [string]$Mode = 'Status',
  [string]$SshHost = 'root@69.62.90.16',
  [string]$KeyPath = 'C:\Users\vboxuser\.ssh\appsalva_prod_ed25519',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

& "$PSScriptRoot\vps_guard.ps1" -Mode $Mode -Profile Homepage -SshHost $SshHost -KeyPath $KeyPath -Force:$Force
exit $LASTEXITCODE