param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
$spec = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'isolated-desktop.cs')
$result = [IsolatedDesktop]::Run($spec.executable, [string[]]$spec.arguments, $spec.cwd, $spec.cancelPath, $spec.parentPid, $spec.timeout)
$result | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $spec.reportPath -Encoding utf8
if ($result.error -or $result.reason -ne 'exit' -or $result.exitCode -ne 0 -or $result.residualProcesses -ne 0 -or -not $result.desktopClosed) { exit 1 }
