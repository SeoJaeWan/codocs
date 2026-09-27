param([string]$Target, [string]$Ready, [string]$Release)
$ErrorActionPreference = 'Stop'
$share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
$stream = [System.IO.File]::Open($Target, 'Open', 'ReadWrite', $share)
try {
  # 읽기 데이터만 잠그고 감시 핸들의 등록은 허용한다.
  $stream.Lock(0, 1)
  [System.IO.File]::WriteAllText($Ready, 'denied')
  while (-not [System.IO.File]::Exists($Release)) { Start-Sleep -Milliseconds 25 }
} finally {
  $stream.Dispose()
}
