param([switch]$SkipInstall)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $repoRoot ".desktop-venv"
$pythonPath = Join-Path $venvPath "Scripts\python.exe"
$distPath = Join-Path $repoRoot "dist"
$workPath = Join-Path $repoRoot "build\desktop"

if (-not (Test-Path $pythonPath)) {
  python -m venv $venvPath
}
if (-not $SkipInstall) {
  & $pythonPath -m pip install --upgrade pip
  & $pythonPath -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
}

Push-Location $repoRoot
try {
  & $pythonPath -m PyInstaller `
    --noconfirm --clean --onefile --windowed `
    --name "Hanex_CAPA_Desktop" `
    --icon "desktop\hanex_capa.ico" `
    --add-data "index.html;." `
    --add-data "app.js;." `
    --add-data "auth.js;." `
    --add-data "styles.css;." `
    --add-data "assets;assets" `
    --add-data "server\serve.py;server" `
    --add-data "server\gaon_client.py;server" `
    --add-data "server\store.py;server" `
    --add-data "desktop\hanex_capa.ico;desktop" `
    --collect-all webview `
    --exclude-module PyQt5 --exclude-module PyQt6 `
    --exclude-module PySide2 --exclude-module PySide6 `
    --distpath $distPath --workpath $workPath `
    desktop_app.py

  $exePath = Join-Path $distPath "Hanex_CAPA_Desktop.exe"
  if (-not (Test-Path $exePath)) { throw "실행 파일 생성에 실패했습니다: $exePath" }
  Write-Host "`n완료: $exePath" -ForegroundColor Green
} finally {
  Pop-Location
}
