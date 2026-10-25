# PRONTO

**Find project media and bring it into your edit—without digging through bins.**

PRONTO is a Premiere Pro extension that puts your project media in a small floating search window. Search for a clip, sound effect, image, or graphic, then add it at the timeline playhead with a click or a key press.

Built for **Premiere Pro 2026 on Windows**. PRONTO is currently a working prototype, so some behavior may vary between Premiere versions and media formats.

## What you can do

- **Search across your project.** Find items inside bins and nested bins by their name or location. You don't need to type the full name.
- **Keep your workspace clean.** The compact window starts with just a search field. Results appear as you type, with icons for different media types.
- **Add media quickly.** Click a result or press Enter to place it at the playhead.
- **Use your track targets.** PRONTO tries enabled video and audio targets first. If they don't have enough room for the full clip, it looks for another available track.
- **Avoid overlapping clips.** Placement checks the space needed by the entire clip, including its audio tracks. If there isn't enough room, PRONTO stops and tells you.
- **Preview sounds.** Use the play button beside an audio result or your preview shortcut to play and pause it before adding it.
- **Open items in the Source Monitor.** Shift+click or Shift+Enter opens the selected item for a closer look.
- **Choose your shortcuts.** Set separate shortcuts for opening PRONTO and playing audio previews.

## Install on Windows

You need Premiere Pro 2026 and the files from this repository.

1. Close Premiere Pro.
2. On GitHub, choose **Code → Download ZIP**, then extract the ZIP.
3. Open the extracted **Pronto** folder containing `install-windows.ps1`. If you downloaded the full workspace, this folder is inside **outputs**.
4. In File Explorer's address bar, type `powershell` and press Enter. This opens a command window in that folder.
5. Paste the following line and press Enter:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
   ```

6. Start Premiere Pro and open **Window → Extensions → PRONTO Launcher**.
7. Click **Search project** to open the floating search window.

The installer copies PRONTO into your Adobe extensions folder. Administrator access isn't required. It also enables loading development extensions, which is needed for this unsigned prototype. That preference applies to other unsigned extensions too; the command's script-running permission applies only to that run.

## Set your shortcuts

In **PRONTO Launcher**, the **Shortcuts** box has two rows:

| Setting | What it does |
| --- | --- |
| Open PRONTO | Opens the floating search window while Premiere is active. |
| Audio preview | Plays or pauses the highlighted audio result while searching. |

Click a shortcut value, wait for **Listening**, then press and release your preferred combination. It saves automatically.

- Use **Ctrl or Alt** with a letter, number, Space, or F1–F11. You can also include Shift.
- Press **Esc** to cancel recording.
- **Right-click** a shortcut value to disable it.
- Use different combinations for opening PRONTO and previewing audio.
- The initial audio-preview shortcut is **Ctrl+Space**. Choose an opening shortcut in the launcher.

Open the launcher once each time you start Premiere to enable the shortcuts. You can switch to another panel tab afterwards.

## Use PRONTO

1. Open your project and move the timeline playhead where you want to add media.
2. Open PRONTO and start typing.
3. Pick a result with the mouse or the Up/Down arrow keys.
4. Click the result or press Enter to add it.

| Action | Control |
| --- | --- |
| Move through results | Up / Down |
| Add the selected media at the playhead | Enter or click the result |
| Open in the Source Monitor | Shift+Enter or Shift+click |
| Play / pause audio preview | Play button or your preview shortcut |
| Refresh search results | Ctrl+R |
| Focus the search field | Ctrl+F |
| Close the search window | Esc |

### How track placement works

PRONTO checks video and audio targets separately. If several targets are enabled, it tries them in track-number order. If none of those have room, it checks other tracks starting from the lowest targeted track number and moving toward higher numbers.

For example, with **A2 and A5** targeted, it tries A2, then A5, then the other eligible tracks from A2 onward. With no audio targets enabled, it starts at **A1**.

The full clip must fit in the available space. PRONTO uses existing tracks; it doesn't create new ones. If no suitable track is free, add an empty track or change your targets and try again.

### About audio preview

Preview plays the original audio file inside PRONTO without changing your timeline or Source Monitor. Playback stops when you change the search or selected result, insert an item, or leave the popup.

Some audio formats may not preview. Use **Shift+Enter** to open those files in Premiere's Source Monitor instead. Preview doesn't apply Premiere effects, channel changes, or source In/Out points.

## Updates and troubleshooting

**To update:** close Premiere, download and extract the newer files, and run the installer again. It backs up the installation it replaces. Restart Premiere afterwards, especially after shortcut changes in an update.

**PRONTO isn't listed in the Extensions menu:** check that the installer finished successfully, then fully close and reopen Premiere. This version is intended for Premiere Pro 2026 on Windows.

**A shortcut doesn't respond:** open PRONTO Launcher, check that the shortcut isn't disabled, and make sure Premiere is active. If another app already uses the combination, choose a different one.

**Newly imported or renamed media isn't showing:** press Ctrl+R in the search window.

**An item won't insert:** make sure a timeline is open, the source media is online, and the destination tracks have enough space. Bins and sequences can appear in search, but aren't inserted by this prototype. Sequences can be opened in the Source Monitor.

**Removing PRONTO:** close Premiere and remove its `local.binsearch.panel` folder from `%APPDATA%\Adobe\CEP\extensions`. This is the folder created by the included installer.

## Current limits

- Windows only for the supplied shortcut helper; macOS isn't supported by this setup.
- The first opening may take longer while Premiere loads the extension.
- Audio preview support depends on the file format.
- PRONTO is a prototype. Try it on a copy of an important project first, and report any unexpected behavior with your Premiere version and the steps that caused it.
