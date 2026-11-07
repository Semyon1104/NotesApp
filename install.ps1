[CmdletBinding()]
param(
    [string]$InstallDir,
    [switch]$NoDesktopShortcut,
    [switch]$NoStartMenuShortcut,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$portableExe = Join-Path $root "Pisa-nina.exe"
$source = if (Test-Path -LiteralPath $portableExe) {
    $root
} else {
    $release = Join-Path $root "release"
    if (-not (Test-Path -LiteralPath (Join-Path $release "Pisa-nina.exe"))) {
        throw "Не найден Pisa-nina.exe. Запустите установщик рядом с приложением."
    }
    $release
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Pisa-nina"
}
$installFull = [IO.Path]::GetFullPath($InstallDir)
if ($installFull -eq [IO.Path]::GetPathRoot($installFull)) {
    throw "Нельзя устанавливать приложение в корень диска."
}
if (Get-Process -Name "Pisa-nina" -ErrorAction SilentlyContinue) {
    throw "Pisa-nina уже открыта. Закройте приложение и запустите установку снова."
}

New-Item -ItemType Directory -Force -Path $installFull | Out-Null
$runtimeFiles = @(
    "Pisa-nina.exe",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll"
)
foreach ($name in $runtimeFiles) {
    $file = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $file)) {
        throw "В папке приложения отсутствует файл: $name"
    }
    Copy-Item -LiteralPath $file -Destination $installFull -Force
}
$sourceUi = Join-Path $source "ui"
if (-not (Test-Path -LiteralPath (Join-Path $sourceUi "index.html"))) {
    throw "В папке приложения отсутствует интерфейс ui\index.html."
}
New-Item -ItemType Directory -Force -Path (Join-Path $installFull "ui") | Out-Null
Copy-Item -Path (Join-Path $sourceUi "*") -Destination (Join-Path $installFull "ui") -Recurse -Force

$readme = Join-Path $source "README.md"
if (-not (Test-Path -LiteralPath $readme)) {
    $readme = Join-Path $root "README.md"
}
if (Test-Path -LiteralPath $readme) {
    Copy-Item -LiteralPath $readme -Destination $installFull -Force
}

$targetExe = Join-Path $installFull "Pisa-nina.exe"

function New-PisaNinaShortcut {
    param([string]$ShortcutPath)
    $shortcutDirectory = Split-Path -Parent $ShortcutPath
    New-Item -ItemType Directory -Force -Path $shortcutDirectory | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($ShortcutPath)
        $shortcut.TargetPath = $targetExe
        $shortcut.WorkingDirectory = $installFull
        $shortcut.IconLocation = "$targetExe,0"
        $shortcut.Description = "Pisa-nina — заметки"
        $shortcut.Save()
    } finally {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    }
}

$created = @()
if (-not $NoDesktopShortcut) {
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    if ($desktop) {
        $desktopShortcut = Join-Path $desktop "Pisa-nina.lnk"
        New-PisaNinaShortcut $desktopShortcut
        $created += $desktopShortcut
    }
}
if (-not $NoStartMenuShortcut) {
    $programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
    if ($programs) {
        $startShortcut = Join-Path $programs "Pisa-nina.lnk"
        New-PisaNinaShortcut $startShortcut
        $created += $startShortcut
    }
}

Write-Host ""
Write-Host "Pisa-nina установлена:" -ForegroundColor Green
Write-Host "  $targetExe"
if ($created.Count -gt 0) {
    Write-Host "Ярлыки:"
    $created | ForEach-Object { Write-Host "  $_" }
}
Write-Host "Данные заметок: $env:LOCALAPPDATA\PoliaNotes\notes.json"
Write-Host ""

if (-not $NoLaunch) {
    Start-Process -FilePath $targetExe -WorkingDirectory $installFull
}