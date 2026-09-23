param([string]$Target, [string]$Ready, [string]$Release)
$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::Open($Target, 'Open', 'ReadWrite', 'None')
try {
  [System.IO.File]::WriteAllText($Ready, 'denied')
  while (-not [System.IO.File]::Exists($Release)) { Start-Sleep -Milliseconds 25 }
} finally {
  $stream.Dispose()
}
