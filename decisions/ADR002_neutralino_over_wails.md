# ADR002 — Neutralino over Wails + Electron

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude

---

## Context

AsymmFlow is deployed at PH Trading WLL as a Windows desktop application. Abhie's core use cases require native file system access:
- Scan a folder of invoices
- Read Excel files exported from suppliers
- Write PDFs to Desktop
- Launch external tools

The reimagined version must be a desktop app. Browser-only is not viable.

The legacy system used **Wails** (Go backend + WebView frontend). This gave file system access via Go's `os` package but required a Go build toolchain and produced ~10MB binaries.

Options considered:

| Runtime | Binary Size | FS Access | Build Complexity | Existing Pattern |
|---------|------------|-----------|-----------------|------------------|
| **Neutralino** | ~2MB | Yes (native API) | npm scripts | Yes (001-ledger desktop) |
| Wails | ~10MB | Yes (Go) | Go + npm | Yes (legacy AsymmFlow) |
| Electron | ~150MB | Yes (Node) | npm + rebuild | No |
| Tauri v2 | ~5MB | Yes (Rust) | Rust + npm | Yes (Rythu Mitra) |
| Browser-only | 0 | No | npm | 001-ledger web |

---

## Decision

**Use Neutralino as the desktop shell. System webview (no bundled browser), ~2MB binary, npm-only build.**

---

## Rationale

### Arguments FOR Neutralino

1. **Existing working pattern from 001-Ledger.**
   The 001-ledger experiment already has a functioning Neutralino configuration.
   We can adapt it directly — the config, the API calls, the build scripts.
   Zero learning curve cost.

2. **Smallest binary.**
   2MB vs 10MB (Wails) vs 150MB (Electron). On Abhie's work machines, this matters
   for distribution and updates. A Neutralino app update is fast to download and install.

3. **No bundled browser.**
   Electron bundles Chromium, inflating binaries to 150MB+.
   Neutralino uses the system webview (WebView2 on Windows).
   This means the rendering engine is always up-to-date (Windows Update handles it).

4. **File system access is the key capability.**
   Abhie's dream: "Take the Q1 invoices folder, pull the Excel files, generate a PowerPoint."
   This requires:
   - `Neutralino.os.scanDir()` — list files in a folder
   - `Neutralino.filesystem.readFile()` — read file contents
   - `Neutralino.os.showOpenDialog()` — native file picker
   - `Neutralino.os.showSaveDialog()` — native save dialog
   All of these exist in Neutralino's standard API.

5. **Cross-platform when needed.**
   Neutralino produces Win/Mac/Linux builds from the same source.
   Today it's Windows (PH Trading). Tomorrow it could be Mac (Abhie's home machine).

### Arguments AGAINST (risks we accept)

1. **System WebView2 on Windows.**
   Requires WebView2 runtime to be installed. On Windows 11, it's pre-installed.
   On Windows 10, it's usually present via Microsoft 365 but not guaranteed.
   - Mitigation: Ship the Neutralino bootstrapper that checks for WebView2
     and prompts to install if missing. Standard Neutralino pattern.

2. **Less Go expertise from legacy.**
   The Go team (Rahul) is familiar with Wails. Moving to Neutralino means
   the backend logic moves to STDB (TypeScript), not Neutralino itself.
   - Mitigation: Neutralino is "just a shell" — the Go team works on STDB reducers,
     not Neutralino. The commander handles the Neutralino config.

3. **Neutralino API surface is smaller than Electron/Node.**
   Complex process management or heavy OS integration may be harder.
   - Mitigation: For AsymmFlow's use cases (files, dialogs, shell commands),
     Neutralino's API is sufficient. Heavy compute stays in STDB reducers or
     client-side (PDF generation via pdfmake, OCR via Sarvam Vision).

---

## Consequences

- **F002 (Neutralino Shell):** Desktop app built on Neutralino. Config adapted from 001-ledger.
- **F022 (scan_folder skill):** Uses `Neutralino.os.scanDir()` — native, no Wails bridge needed.
- **F023 (ocr_document skill):** Reads file bytes via Neutralino, posts to Sarvam Vision API.
- **All File Skills:** Use Neutralino filesystem API, not Go's `os` package.
- **Distribution:** Single .exe file, ~2MB. Updatable via `neutralino-updater` pattern.

---

## References

- `ARCHITECTURE.md` §2 — Three concentric rings architecture (Neutralino outer ring)
- `001-ledger/desktop/` — Working Neutralino configuration to adapt
- Neutralino docs: `https://neutralinojs.org/docs`
- `audit_intelligence.md` §2.3 — File-based skill architecture
