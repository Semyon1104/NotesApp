# Repository Guidelines

## Project Structure & Module Organization

Pisa-nina is a local Windows notes application built with .NET Framework 4.8, WinForms, WebView2, and a plain HTML/CSS/JavaScript interface.

- `desktop/Program.cs` — native host, JSON persistence, file dialogs, speech recognition, and the WebView2 command bridge.
- `ui/` — frontend source: `index.html`, `styles.css`, and `app.js`.
- `test/e2e.mjs` — end-to-end checks driven through the WebView2 DevTools protocol.
- `lib/webview2/` — vendored WebView2 SDK; `release/` and `dist/` contain generated builds.
- `build.ps1` — compilation and portable packaging; `install.ps1` installs with desktop/Start-menu shortcuts.

User data is stored in `%LOCALAPPDATA%\PoliaNotes\notes.json`. `POLIA_DATA_DIR` overrides this location for test runs.

## Build, Test, and Development Commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

Builds `release\Pisa-nina.exe` and `dist\Pisa-nina-portable.zip`. Use `-SkipPackage` for a quick compile.

```powershell
$env:POLIA_DATA_DIR='C:\sema\NotesApp\.test-data'
$env:POLIA_TEST_MODE='1'
Start-Process -FilePath (Resolve-Path 'release\Pisa-nina.exe') `
  -WorkingDirectory (Resolve-Path 'release') -WindowStyle Hidden
node test\e2e.mjs
```

Wait until the WebView2 test page is ready on port `9333`; rerun the Node command if the first connection is refused. There is no npm package or separate dev server.

## Coding Style & Naming Conventions

Use four spaces for C# and two spaces for JavaScript/CSS. Keep existing native code compatible with C# 5 (`Program.cs` is compiled with `/langversion:5`). Preserve Allman braces in C#, semicolons and double quotes in JavaScript, and kebab-case CSS classes. Use PascalCase for public C# types/properties and camelCase for JS variables/functions. Match surrounding code; no formatter or linter is configured.

## Testing Guidelines

Tests are assertion-based E2E scenarios covering persistence, categories, drag-and-drop, resizing, editing, images, folders, and voice-input mocks. Add or update `test/e2e.mjs` when changing user-visible behavior. Always test against `.test-data`, never personal notes, and clean temporary profiles after runs.

## Version Control & Change Notes

The workspace currently has no Git metadata or established commit convention. Do not create commits unless explicitly requested. When changing storage fields, preserve backward compatibility with existing `notes.json` files and update `README.md` for user-visible behavior.