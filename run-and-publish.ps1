# kotoba-no-sekai: run pipeline then publish
# Designed for use with Windows Task Scheduler

$ProjectDir = "C:\Users\billb\projects\kotoba-no-sekai"
$LogDir = "$ProjectDir\logs"
$LogFile = "$LogDir\kotoba-$(Get-Date -Format 'yyyy-MM-dd').log"
$NodeExe = "node"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp  $Message" | Tee-Object -FilePath $LogFile -Append
}

Set-Location $ProjectDir

Write-Log "=== Starting pipeline ==="

& $NodeExe --env-file-if-exists=.env dist/index.js 2>&1 | Tee-Object -FilePath $LogFile -Append
if ($LASTEXITCODE -ne 0) {
    Write-Log "Pipeline failed with exit code $LASTEXITCODE. Aborting publish."
    exit $LASTEXITCODE
}

Write-Log "Pipeline complete. Starting publish..."

& $NodeExe --env-file-if-exists=.env dist/index.js --publish 2>&1 | Tee-Object -FilePath $LogFile -Append
if ($LASTEXITCODE -ne 0) {
    Write-Log "Publish failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Log "Publish complete."
