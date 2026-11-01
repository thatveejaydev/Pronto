# PRONTO

![Release v0.1.0](https://img.shields.io/badge/release-v0.1.0-orange)
![Platform Windows 10 and 11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows&logoColor=white)
![Adobe Premiere Pro 2024+](https://img.shields.io/badge/Premiere%20Pro-2024%2B-9999FF?logo=adobepremierepro&logoColor=white)
![Adobe CEP 11 and 12](https://img.shields.io/badge/Adobe%20CEP-11%20%7C%2012-5C5C5C)
![Signed ZXP](https://img.shields.io/badge/package-signed%20ZXP-2EA44F)
![License All rights reserved](https://img.shields.io/badge/license-all%20rights%20reserved-lightgrey)

**Find anything in your Adobe Premiere project and place it on the timeline in seconds.**

PRONTO is a fast, keyboard-friendly search palette for Adobe Premiere Pro on Windows. Search clips, sound effects, images, graphics, sequences, and bins without digging through the Project panel. PRONTO previews where media will land, then places it at the playhead in the first collision-free track space without rippling the edit.

Current release: **0.1.0** · Windows · Premiere Pro 2024 or newer

## ✨ Why editors use PRONTO

- **Stop hunting through bins.** Search names and full bin paths from one floating window.
- **Protect the timeline.** PRONTO checks the entire source duration and looks for free video and audio destinations before placement.
- **See the result before inserting.** A compact placement preview shows safety status, destination tracks, playhead time, and duration.
- **Work almost entirely from the keyboard.** Open PRONTO with a custom shortcut, navigate with arrows, cycle filters with Tab, and place with Enter.
- **Audition sound effects quickly.** Preview trimmed audio directly in the result list or enable automatic preview while navigating.
- **Reach frequently used media faster.** Project-specific recents and frequency-aware ranking bring common assets toward the top.

## 🚀 Features

### 🔎 Fast project-wide search

PRONTO searches project items using exact, partial, multi-word, fuzzy, and bin-path matching. Results include Premiere label-color dots and clear media-type icons.

Use the filter pills or type a prefix:

| Prefix | Finds |
|---|---|
| `a:`, `@audio`, `sfx:` | Audio and sound effects |
| `v:`, `@video` | Video clips |
| `i:`, `@image` | Still images |
| `g:`, `@graphic` | Graphics, MOGRTs, and titles |
| `s:`, `@seq` | Sequences |
| `b:`, `@bin` | Project bins |

Examples: `a: impact`, `v: drone beach`, `b: music`, or simply part of an item name.

### 🛡️ Safe placement preview

Selecting a result immediately checks the active timeline:

- **SAFE** means PRONTO found collision-free destination tracks.
- **BLOCKED** explains why placement is unavailable.
- Blue `V` badges show video tracks; teal `A` badges show audio tracks.
- The preview shows the destination, playhead time, and inserted duration.
- Video with linked audio is planned together, while silent video and still images only require video space.

PRONTO checks clips and transitions across the source duration, prefers targeted tracks, detects offline media, prevents circular sequence nesting, and validates the edit after Premiere performs it.

### 🎧 Audio auditioning

- Preview audio from the results without opening the Source Monitor.
- Start at the clip's Premiere **In point** and stop at its **Out point**.
- Follow playback with a progress bar in the active result.
- Enable **Auto-preview selected audio** to audition clips while typing or navigating.
- Assign a separate audio-preview shortcut in the launcher.
- Use **Shift+Enter** when a codec needs Premiere's Source Monitor.

Local drives and UNC network paths are supported when the CEP browser can decode the audio format.

### 🕘 Recents and smarter ranking

Press **Down Arrow** with an empty search field or choose **Recent** to see the last 15 items used in the current project. Frequently used items receive a ranking boost, making recurring sound effects, adjustment layers, graphics, and sequences easier to reach.

### 🎬 More than timeline insertion

- Open media in the Source Monitor.
- Open or switch to a sequence in the Timeline panel.
- Open a sequence in the Source Monitor.
- Reveal and highlight any item or bin in the Project panel.
- Place nested sequences while preventing direct and indirect circular nesting.
- Use Premiere's default still-image duration when an image has no source In/Out points.
- Use a sequence's timeline duration when it has no source In/Out points.

### ⚙️ Designed to stay responsive

PRONTO keeps an in-memory project catalog, reuses rendered result rows, limits ranking work to the best 100 visible matches, caches validated project-item references, and combines rapid placement-preview requests. Reopening the palette can use the remembered catalog immediately while the active project and timeline are verified in the background.

## ⌨️ Keyboard reference

| Key | Action |
|---|---|
| `Up` / `Down` | Move through search results |
| `Tab` / `Shift+Tab` | Cycle filters forward or backward |
| `Enter` | Place media at the playhead, or reveal a bin |
| `Shift+Enter` | Open media in Source Monitor, or open a sequence in Timeline |
| `Ctrl+Shift+Enter` | Open a sequence in Source Monitor |
| `Alt+Enter` | Reveal the selected item in the Project panel |
| Configured preview shortcut | Play or pause selected audio |
| `Ctrl+F` | Focus and select the search text |
| `Ctrl+R` | Rescan the active project |
| `Esc` | Stop audio and close PRONTO |

Mouse users can click a result to place it, Shift-click to open it, Alt-click to reveal it, or use the play button beside an audio result.

## 📦 Installation

### 🔐 Signed ZXP release

Install `PRONTO-0.1.0.zxp` with a CEP-compatible ZXP installer, then open Premiere and choose **Window → Extensions → PRONTO Launcher**.

### 🧪 ZIP installer for testing

1. Download and extract `PRONTO-0.1.0-windows.zip`.
2. Close Adobe Premiere Pro.
3. Double-click **`Install PRONTO.bat`**.
4. Reopen Premiere and choose **Window → Extensions → PRONTO Launcher**.
5. Click **Search project** and optionally record shortcuts in the launcher.

Updating replaces the previous PRONTO installation without creating a backup. To remove it, close Premiere and run **`Uninstall PRONTO.bat`**. Premiere projects, media, and saved shortcut preferences are not removed.

## 🖥️ Compatibility

- Windows 10 or Windows 11
- Adobe Premiere Pro 2024 or newer (`PPRO 24.0+`)
- Adobe CEP/CSXS 11 or 12

macOS is not currently supported because PRONTO's application-scoped shortcut helper uses Windows APIs and PowerShell.

## ⚠️ Known limitations

- Premiere's CEP API does not provide an atomic insert-and-rollback operation. PRONTO validates placement afterward, but an unexpected Premiere placement may require **Undo**.
- Unknown or adaptive audio layouts are checked conservatively and can require more free audio-track space than expected.
- Locked or incompatible destination tracks can prevent placement.
- Audio preview depends on codecs available to Premiere's CEP browser.
- Automated tests simulate Premiere's API; releases should also be smoke-tested inside supported Premiere versions.

For help or bug reports, see [SUPPORT.md](SUPPORT.md) or open a [GitHub issue](https://github.com/thatveejaydev/Pronto/issues).

## 🛠️ Development and releases

Requirements: Node.js 20+ and Windows PowerShell 5.1 or PowerShell 7.

```powershell
npm test
npm run validate:hotkey
npm run package
```

`npm run package` creates `dist/PRONTO-0.1.0-windows.zip`.

Create the signing identity once, then build a signed and verified ZXP:

```powershell
npm run certificate:create
npm run sign:zxp
```

The signing certificate and its Windows DPAPI-encrypted password are stored under ignored `.tools/signing/`. Back up both files securely. Each new plugin version must be packaged into a new ZXP using the same certificate.

For an external certificate or signer, set `PRONTO_ZXP_SIGN_CMD`, `PRONTO_ZXP_CERTIFICATE`, `PRONTO_ZXP_CERT_PASSWORD`, and optionally `PRONTO_ZXP_TIMESTAMP_URL` before running `npm run sign:zxp`.

Release history is available in [CHANGELOG.md](CHANGELOG.md).

## 📄 License

No open-source license has been selected. Unless a license is added, copyright law reserves reuse and redistribution rights by default.
