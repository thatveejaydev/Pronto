# Version 0.2 validation

29 automated tests passed using node tests/test.cjs. Host and DOM are simulated. Coverage includes nested/fuzzy search, Unicode and duplicate identity, serialization, project/timeline guards, offline/missing items, first free full-duration gap, touching boundaries, transitions, independent video/audio selection, multichannel blocks, unknown audio mapping fallback, unknown duration rejection, source trims, longest stream bounds, key navigation/repeat/IME handling, popup close-on-success and stay-open-on-error.

JavaScript syntax, installer syntax and manifest XML are checked separately. No live Premiere edit, installation, registry change or visual UI test was performed during this revision. The installed host was previously inspected as Premiere 26.3.0 / CEP 12.0.1. Follow README's smoke test for real routing, duration, window activation and Undo behavior.
