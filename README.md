# PRONTO — Smart Floating Search & Non-Ripple Placement for Premiere Pro

**PRONTO** (`com.pronto.ppro`) is a floating search palette for Adobe Premiere Pro on Windows. It lets you search every bin, clip, graphic, audio file, and sequence in your project and place items at the playhead in the **first collision-free track gap** without overwriting or rippling existing timeline clips.

---

## Quick Install & Uninstall (Windows)

### To Install or Update
1. Close **Adobe Premiere Pro**.
2. Double-click **`Install PRONTO.bat`** in this folder.
3. Open Premiere Pro and go to **Window > Extensions > PRONTO Launcher**.
4. Click **Search project** (or click the shortcut badge to record a global hotkey like **Alt+Space**).

*Note: Previous PRONTO installations in `%APPDATA%\Adobe\CEP\extensions` are automatically backed up to `%APPDATA%\Adobe\ProntoBackups` before installing.*

### To Uninstall
1. Close **Adobe Premiere Pro**.
2. Double-click **`Uninstall PRONTO.bat`** in this folder.

---

## Key Features

1. **Instant Category Filter Pills & Prefix Search**
   - Filter results with one click using the **All / Recent / Audio / Video / Image / Graphic / Seq / Bin** pill bar, or type prefixes directly in the search box:
     - `a:` or `@audio` or `sfx:` — Audio files only
     - `v:` or `@video` — Video clips only
     - `i:` or `@image` — Still images only
     - `g:` or `@graphic` — Graphics / MOGRTs / Titles only
     - `s:` or `@seq` — Sequences only
     - `b:` or `@bin` — Bins (folders) only

2. **Recent Items & Frecency Ranking**
   - Press **Down Arrow** on an empty search box (or click the **Recent** pill) to immediately see your last 15 placed/opened items in the current project.
   - Frequently used clips (like favorite sound effects or adjustment layers) receive a smart ranking boost in search results.

3. **Premiere Label Color Dots**
   - Every search result displays its Premiere Pro label color dot (Violet, Iris, Caribbean, Mango, etc.) right next to the item name.

4. **Smarter Audio Preview (Trimmed In/Out + Progress Bar + Auto-Preview)**
   - **Trimmed playback:** Audio preview starts at the clip's Premiere **In point** and stops at its **Out point** if trimmed.
   - **Live progress bar:** Shows a real-time progress bar along the bottom of the active audio row.
   - **Auto audio preview toggle:** Enable **Auto audio preview** in the **PRONTO Launcher** to automatically preview audio clips as you arrow up and down through results. All tips, search prefixes, and quick filter pill instructions are also built right into the **Tips, Prefixes & Usage Guide** dropdown inside the Launcher.

5. **Sequence, Still Image & Bin Workflows**
   - **Silent visuals & photos:** Still images, legacy titles, and zero-audio-channel video clips only require an empty video track—even if all audio tracks are full.
   - **Un-trimmed Sequence & Photo duration fallbacks:** If a sequence has no Source Monitor In/Out points set, PRONTO automatically reads the sequence's timeline duration (`sequence.end`). If a still photo has no In/Out points reported, it falls back to Premiere's still-image default duration preference.
   - **Complete keyboard actions:**
     - **`Enter` / Click**: Places media or nested sequence on the timeline at the playhead (or highlights a Bin in the Project panel).
     - **`Shift+Enter` / Shift+Click**: Opens media in the **Source Monitor**, or opens/switches to a **Sequence tab** in the Timeline.
     - **`Ctrl+Shift+Enter`**: Opens a **Sequence** in the **Source Monitor**.
     - **`Alt+Enter` / Alt+Click**: Highlights/reveals **any** item or bin inside Premiere's Project panel.

6. **Zero-Drop Queued Actions on Reopen**
   - Reopening the palette searches the remembered in-memory catalog immediately while verifying the active project/timeline in the background. If you press `Enter` within the first few milliseconds while the context check is still running, PRONTO queues your action and executes it automatically as soon as verification completes.
