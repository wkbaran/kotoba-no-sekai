# kotoba-no-sekai: run pipeline then publish
# Designed for use with Windows Task Scheduler

$ProjectDir = "C:\Users\billb\projects\kotoba-no-sekai"
$LogDir = "$ProjectDir\logs"
$LogFile = "$LogDir\kotoba-$(Get-Date -Format 'yyyy-MM-dd').log"
$NodeExe = "node"

# Node writes UTF-8 to stdout, but PowerShell 5.1 decodes a child process's
# output using the console's legacy codepage unless told otherwise, which
# turns Japanese text into mojibake. Force UTF-8 decoding of captured output.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$timestamp  $Message"
    Write-Output $line
    $line | Out-File -FilePath $LogFile -Append -Encoding utf8
}

# Windows PowerShell 5.1's Tee-Object has no -Encoding param, so it always
# writes UTF-16, which is unreadable from a standard terminal. Capture the
# command's output instead, then print it and append it to the log ourselves
# with -Encoding utf8. This buffers output until the command finishes rather
# than streaming it live, which is fine for a non-interactive scheduled task.
function Run-Logged {
    param([scriptblock]$Command)
    $output = & $Command 2>&1
    $output | ForEach-Object { Write-Output $_ }
    $output | Out-File -FilePath $LogFile -Append -Encoding utf8
}

Set-Location $ProjectDir

Write-Log "=== Building ==="

Run-Logged { npm run build }
if ($LASTEXITCODE -ne 0) {
    Write-Log "Build failed with exit code $LASTEXITCODE. Aborting."
    exit $LASTEXITCODE
}

Write-Log "=== Starting pipeline ==="

Run-Logged { & $NodeExe --env-file-if-exists=.env dist/index.js }
if ($LASTEXITCODE -ne 0) {
    Write-Log "Pipeline failed with exit code $LASTEXITCODE. Aborting publish."
    exit $LASTEXITCODE
}

Write-Log "Pipeline complete. Starting publish..."

Run-Logged { & $NodeExe --env-file-if-exists=.env dist/index.js --publish }
if ($LASTEXITCODE -ne 0) {
    Write-Log "Publish failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Log "Publish complete."
