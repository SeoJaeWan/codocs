param([string]$Target,[string]$Ready)
$ErrorActionPreference = 'Stop'
$stream = [IO.File]::Open($Target,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try { [IO.File]::WriteAllText($Ready, 'locked'); while ($true) { Start-Sleep -Seconds 1 } }
finally { $stream.Dispose() }
