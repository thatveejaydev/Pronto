# PRONTO performance update

- The shortcut helper now waits for Windows messages instead of sleeping between hotkey checks. Its 75 ms timeout remains only for foreground and owner-liveness checks.
- The launcher requests persistence for the popup as well as itself, allowing Premiere to retain its loaded UI between openings. Reopening resets the query and project data. First opening still requires CEP initialization; modeless persistence and actual display latency require a live Premiere check.
- No project indexing runs on empty-popup opening. Each new search session reads the current project; pending results from dismissed sessions are ignored.
- Arrow navigation updates selection attributes without rebuilding result rows.
- Search normalizes item names and paths once per index and stops evaluating an item after a token fails.
- Existing timeline safety and Source Monitor checks remain enabled.

Validation: 52 mock-host/DOM tests, shortcut recording tests, and native helper compilation/capture tests passed. In a local Node benchmark of 20,000 items and six queries (nine measured batches after warm-up), median batch time was 48.92 ms before and 19.51 ms after, with identical ranked results. This measures filtering, not Premiere display latency.

References: [Adobe persistence example](https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PPRO/Premiere.jsx), [Windows message waiting](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-msgwaitformultipleobjectsex).

Restart Premiere after installing this update to reload the persistent UI and restart the shortcut helper.
