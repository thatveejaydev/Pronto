# PRONTO 0.2 — floating search palette

## Install or update on Windows

1. Close Premiere and extract the new ZIP.
2. Open PowerShell inside the extracted BinSearch folder and run:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
~~~

3. Restart Premiere. Open **Window > Extensions > PRONTO Launcher** and click **Search project**. A separate floating search window opens with the search field focused. If Premiere lists **PRONTO** directly in Extensions, that also opens the popup.
4. Set the timeline playhead, search for project media, use ↑/↓ and press Enter. Successful placement closes the popup; an error leaves it open. Escape or × dismisses it.

The installer updates the existing user extension and first copies the previous installation into %APPDATA%\Adobe\BinSearchBackups. It does not install a second copy. The destination remains %APPDATA%\Adobe\CEP\extensions\local.binsearch.panel. No administrator privileges are needed. It enables unsigned CEP 12 development extensions via the current user's CSXS.12 PlayerDebugMode string setting. This preference also affects other unsigned CEP 12 extensions. The execution-policy override applies only to the installer process.

Manual installation: copy CSXS, index.html, style.css, search.js, panel.js, host.jsx, launcher.html and launcher.js into that destination, replacing the older runtime files. CSXS/manifest.xml must sit directly beneath the extension folder. Set HKEY_CURRENT_USER\Software\Adobe\CSXS.12\PlayerDebugMode to the string 1, then restart.

On macOS (not tested), copy those runtime files to ~/Library/Application Support/Adobe/CEP/extensions/local.binsearch.panel and run:

~~~sh
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
~~~

## What changed

- Compact dark floating search palette, inspired by the supplied reference. A launcher panel opens the actual modeless window; it is no longer a search panel you must manually undock.
- Video/audio selectors removed. Tracks are chosen automatically at the moment you press Enter.
- Placement uses a non-ripple edit into checked empty space. Existing later clips should keep their positions.
- Escape closes; successful placement closes; failures stay visible.

Windows shortcut support is now included. Open the launcher, enter a combination and click Save shortcut. See SHORTCUT.md for setup and session behavior.

## How first-free placement works

The host reads the current playhead and source In/Out ranges. It reserves the longest reported audio/video/combined range, rounded up to a timeline frame. From V1 upward, it finds the lowest numbered existing video track without any clip or transition intersecting that entire interval. Audio is searched independently from A1 upward. A clip ending exactly at the playhead or starting exactly at the placement end does not block the gap.

When audioClipsNumber is available, the full contiguous audio-track block is checked for multichannel sources. When that property is unavailable, every existing audio track from a candidate start index onward must be clear for the duration. That conservative fallback can skip an otherwise usable lower audio gap. Premiere may create additional audio tracks for source routing; the extension itself does not create tracks.

The edit calls Sequence.overwriteClip only after the destination intervals pass these checks. Despite that API name, occupied candidate intervals are rejected; using insertClip here would ripple existing clips, which is not the requested behavior. If no suitable space exists, no editing call is made: add empty tracks and retry. Unknown source duration or unreadable timeline bounds also stops before editing.

Both a video and audio track are conservatively required and checked even for single-stream sources. This avoids guessing stream presence from file extensions, but can unnecessarily reject an audio-only or video-only item. The extension does not use timeline track targeting/source patching controls to choose destinations.

## Search behavior

Search includes all nested bins in the active project. Filename and full bin path participate in case-insensitive substring/subsequence matching. Space-separated terms can match different parts of the path. This is not typo correction or semantic search. Duplicate filenames retain distinct project-item IDs. Bins and sequences are shown for context but remain search-only. Up to 200 results are displayed; all indexed items are filtered.

The popup indexes on opening. Use ↻ after project changes while it is open. A project/timeline switch requires refresh; the host checks identity again before editing. Removed and offline media are rejected. Holding Enter or pressing it again while an edit is in flight does not issue duplicate edits. Source In/Out points are honored, not reset. No project is saved automatically.

## Limitations and live validation

**This is still a prototype. No live Premiere edit or visual UI test was performed during this revision.** The no-overlap checks are covered with simulated-host tests, not proof of Premiere's actual routing on every media type. Validate on a disposable sequence before regular use.

- CEP's public Track DOM does not provide a dependable lock-state check here. Unlock candidate tracks before use. A host rejection is reported; it is not automatically retried on another track because the result could be partial.
- Standard imported video, WAV and still sources are intended. Sequence nesting, merged/multicam clips, MOGRTs, captions and unusual generated/Dynamic Link media are not validated. Still duration and interpreted-frame-rate sources particularly need live checks against Premiere's returned In/Out ranges.
- Audio routing/track-type compatibility is controlled by Premiere. Check multichannel and mono/stereo mappings in the smoke test. Source media with unusual split In/Out ranges may reserve more space than necessary.
- No automatic video-track creation, cross-project search or thumbnails. Large projects can briefly pause during synchronous indexing.
- No custom undo group or automatic rollback; use Premiere's native Undo and inspect the result. If a host error follows an edit attempt, inspect the timeline before retrying.
- Modeless-window focus, position and native title-bar styling are host-controlled. Search input receives focus on load; actual window activation must be checked in Premiere.

## Smoke test

1. In a disposable project, place a five-second source at a playhead of ten seconds. Put an existing clip on V1 at 12–20 seconds and leave V2 clear. Verify the new video goes to V2 at ten seconds, the existing clip stays intact, and its position does not change.
2. Put audio on A1 covering 10–15 seconds; leave A2 clear. Verify independent audio routing to A2. Test a multichannel source with enough consecutive empty tracks.
3. Make V1 free from 10–15 seconds, with clips ending at 10 and beginning at 15. Verify the five-second source fits on V1 without modifying either neighbor. Repeat with a transition occupying part of the gap; that track should be skipped.
4. Fill all eligible tracks during that interval. Enter should show an error and make no edit. Add empty tracks and retry.
5. Test a trimmed source, audio-only source, still image, interpreted-frame-rate source and native Undo. Confirm actual duration equals the reserved interval and later clips never shift.
6. Verify popup open/focus, fuzzy nested-path search, arrows, Enter auto-close, Escape dismissal, reopen and refresh. Hold Enter to check repeat suppression. Test offline/deleted items and project/timeline changes: errors must leave the popup open.

## Compatibility and implementation references

The local Premiere executable was inspected as 26.3.0 (26.3.0.93), with CEPHtmlEngine 12.0.1. The manifest targets Premiere 26.x and CSXS 12. Adobe's [current transition guidance](https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/cep-uxp-plugin-transition.html) supports using CEP for this prototype; UXP remains the long-term platform.

Adobe's [CEP 12 cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md) describes modeless extensions and unsigned development setup. Its [CSInterface source](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/CSInterface.js) supplies the native bridge patterns for requestOpenExtension, closeExtension and evalScript. Adobe's [Premiere sample declarations](https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PremierePro.23.0.d.ts) describe track clips/transitions, item time bounds and audio-channel mapping. The extension uses no QE APIs, external libraries or network access; the launcher uses Node to start its local Windows shortcut helper.

## Files and verification

CSXS/manifest.xml registers the launcher and popup. launcher.html/js opens the popup. index.html/style.css/panel.js implement search UI and CEP communication; search.js ranks matches; host.jsx does project traversal and placement checks. Run **node tests/test.cjs** for the 29 mock-host tests. See TEST-RESULTS.md for scope.

If the launcher is missing, check the installation folder nesting and CSXS.12 preference, and fully restart Premiere after replacing the manifest. A browser preview cannot access the project. If source duration cannot be read, set explicit source In/Out points; do not bypass the check.

To uninstall, close Premiere and remove only local.binsearch.panel from the user CEP extensions folder. Restore the prior PlayerDebugMode value only if other development extensions do not rely on it. To roll back, restore the corresponding backed-up folder to that location with Premiere closed.


Track targeting: PRONTO reads enabled video and audio track targets when you insert. It tries targeted tracks in numerical order, then untargeted tracks at or above the lowest target number. With no targets enabled for that media type, it starts at track 1. A destination must have room for the full clip (and all mapped audio tracks). If no eligible destination is free, insertion stops without editing. Existing track targets are not changed.

Audio preview: click the play button on an online audio result or press Ctrl+Space to play/pause the highlighted result. Changing the query/selection, inserting, opening the Source Monitor, or dismissing/leaving PRONTO stops playback. Preview plays the original source file independently of Premiere, without applying Premiere effects/channel mapping or source In/Out points. Format support depends on CEP; use Shift+Enter for files it cannot play. The media path is fetched only on demand. No network playback or external decoder is used.
