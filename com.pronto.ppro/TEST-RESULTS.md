# Version 0.2 validation

29 automated tests passed using node tests/test.cjs. Host and DOM are simulated. Coverage includes nested/fuzzy search, Unicode and duplicate identity, serialization, project/timeline guards, offline/missing items, first free full-duration gap, touching boundaries, transitions, independent video/audio selection, multichannel blocks, unknown audio mapping fallback, unknown duration rejection, source trims, longest stream bounds, key navigation/repeat/IME handling, popup close-on-success and stay-open-on-error.

JavaScript syntax, installer syntax and manifest XML are checked separately. No live Premiere edit, installation, registry change or visual UI test was performed during this revision. The installed host was previously inspected as Premiere 26.3.0 / CEP 12.0.1. Follow README's smoke test for real routing, duration, window activation and Undo behavior.

## Silent visuals placement — 2026-10-27

All 81 tests in tests/test.cjs pass under Node. These are mock-host/DOM tests, not a live Premiere integration test.

New coverage: zero audio mapping for photos, graphics and video (property and callable forms); still-image/legacy-title fallback; sequences without audio tracks; video target priority and full video tracks; audio-bearing graphics/video protection; invalid/unknown mapping; misleading renamed items; unexpected audio placement detection.

Live check: place a photo, title and video with no audio stream while every audio track is occupied. Confirm video placement follows targets and existing audio remains unchanged. Repeat with audio-bearing media and confirm collision protection. Mapping unavailable for video/modern graphics remains conservative.

## Retained search index — 2026-10-27

93 host/panel/search mock tests pass, plus the preview and preview-settings suites. New tests cover cache reuse, background refresh, selection and preview preservation, insertion during refresh, project/timeline changes, project closure, refresh failure, duplicate-request suppression, late completion after closing, and Ctrl+R. No live Premiere timing measurements were performed. First load and background refresh still use the synchronous host indexing API; hidden CEP timers may run late.

## Sequence actions — 2026-10-27

103 mock-host/panel tests pass. Added sequence index eligibility, nested insertion at the playhead, occupied/targeted tracks, direct and indirect nesting rejection, timeline-open readback, sequence names resembling audio filenames, Enter/Shift+Enter and Shift-click routing. Media still uses the Source Monitor. Live Premiere verification of sequence duration and nested audio routing remains required.

## Bin actions — 2026-10-27

109 mock-host/panel tests pass. Added Bin classification with string type values, Bin priority over sequence flags, distinct folder-icon rendering, Enter/click/Shift routing with no active timeline, correct-project view selection, stale/removed/non-bin guards, selection readback and failure UI. Live Premiere verification is still needed. The implementation selects/highlights bins; it does not claim to open their contents or force panel focus.
