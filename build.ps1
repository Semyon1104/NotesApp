[CmdletBinding()]
param(
    [switch]$SkipPackage
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$release = Join-Path $root "release"
$uiSource = Join-Path $root "ui"
$webView = Join-Path $root "lib\webview2"
$program = Join-Path $root "desktop\Program.cs"

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
    throw "Не найден компилятор C# (.NET Framework 4.x). Установите .NET Framework 4.8 Developer Pack."
}

$webCore = Join-Path $webView "Microsoft.Web.WebView2.Core.dll"
$webForms = Join-Path $webView "Microsoft.Web.WebView2.WinForms.dll"
$webLoader = Join-Path $webView "WebView2Loader.dll"
foreach ($file in @($webCore, $webForms, $webLoader)) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "Не найден файл WebView2 SDK: $file"
    }
}

$speechSearch = @(
    "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework",
    "$env:WINDIR\Microsoft.NET\assembly\GAC_MSIL\System.Speech"
)
$speech = Get-ChildItem -Path $speechSearch -Recurse -Filter "System.Speech.dll" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $speech) {
    throw "Не найден System.Speech.dll. Установите .NET Framework 4.8 Developer Pack."
}

New-Item -ItemType Directory -Force -Path (Join-Path $release "ui") | Out-Null
Copy-Item -Path (Join-Path $uiSource "*") -Destination (Join-Path $release "ui") -Recurse -Force
Copy-Item -LiteralPath $webCore, $webForms, $webLoader -Destination $release -Force

$compilerArguments = @(
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/langversion:5",
    "/win32manifest:$(Join-Path $root 'desktop\app.manifest')",
    "/win32icon:$(Join-Path $root 'desktop\icon.ico')",
    "/out:$(Join-Path $release 'Pisa-nina.exe')",
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    "/r:$($speech.FullName)",
    "/r:$webCore",
    "/r:$webForms",
    $program
)

Write-Host "Сборка Pisa-nina..." -ForegroundColor Green
& $csc $compilerArguments
if ($LASTEXITCODE -ne 0) {
    throw "Сборка завершилась с кодом $LASTEXITCODE."
}
Write-Host "Готово: $(Join-Path $release 'Pisa-nina.exe')" -ForegroundColor Green
$legacyExe = Join-Path $release "PoliaNotes.exe"
if (Test-Path -LiteralPath $legacyExe) {
    Remove-Item -LiteralPath $legacyExe -Force
}

if ($SkipPackage) {
    return
}

$dist = Join-Path $root "dist"
$stage = Join-Path $dist "Pisa-nina"
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$legacyStage = Join-Path $dist "PoliaNotes"
$legacyStageFull = [IO.Path]::GetFullPath($legacyStage)
if (-not $legacyStageFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Небезопасный путь очистки: $legacyStageFull"
}
if (Test-Path -LiteralPath $legacyStage) {
    Remove-Item -LiteralPath $legacyStage -Recurse -Force
}
$legacyZip = Join-Path $dist "PoliaNotes-portable.zip"
if (Test-Path -LiteralPath $legacyZip) {
    Remove-Item -LiteralPath $legacyZip -Force
}
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$stageFull = [IO.Path]::GetFullPath($stage)
if (-not $stageFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Небезопасный путь упаковки: $stageFull"
}
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "ui") | Out-Null

Copy-Item -LiteralPath (Join-Path $release "Pisa-nina.exe"), $webCore, $webForms, $webLoader -Destination $stage -Force
Copy-Item -Path (Join-Path $release "ui\*") -Destination (Join-Path $stage "ui") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "README.md"), (Join-Path $root "install.ps1"), (Join-Path $root "install.cmd") -Destination $stage -Force

$zip = Join-Path $dist "Pisa-nina-portable.zip"
if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Портативная версия: $zip" -ForegroundColor Green