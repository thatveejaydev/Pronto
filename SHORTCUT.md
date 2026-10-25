# Open PRONTO with a shortcut (Windows)

1. Restart Premiere after this update; the launcher manifest now enables the local shortcut helper.
2. Open **Window > Extensions > PRONTO Launcher**.
3. Under **Open search shortcut**, click **Record shortcut**, wait for Listening, then press and release your combination (including **Alt+Space**). It saves and registers automatically. You can also type Alt+Space and click Save shortcut.
4. Focus the Premiere timeline and press the shortcut. The floating search window opens with its search field focused.

Use Ctrl and/or Alt, optionally Shift, with A–Z, 0–9, Space, or F1–F11. F12 and Windows-key combinations are excluded. If another program has registered the same combination, the launcher reports a conflict. Avoid Premiere commands using the same keys: the helper takes precedence while registered.

During recording, the previous shortcut is temporarily suspended. Escape, Cancel recording or the 20-second timeout restores it. Recording uses a temporary Windows keyboard hook only while the recorder is active; no typed text is saved. Alt+Space is intercepted during recording so it does not open the system menu.

The shortcut setting is remembered. Load the launcher once per Premiere session, or keep it in your saved workspace so Premiere restores it. You may switch to other panel tabs afterwards. If you fully close/unload the launcher, reopen it to restore the shortcut. **Disable shortcut** releases the keys and turns off automatic restoration.

This is a PRONTO shortcut setting, not an entry added to Premiere's native Keyboard Shortcuts editor. A small hidden Windows helper receives the configured hotkey and asks CEP to open the popup. It registers only while Premiere is the foreground app (with a short polling delay), suppresses key-repeat, and exits when the launcher closes or its CEP process exits. No network listener, additional download, administrator access, startup task or permanent PowerShell policy change is used. The helper runs with a process-only execution-policy override, just like the development installer.

Validation: JavaScript syntax and 9 shortcut parsing cases passed; the helper's C# code compiled successfully. Opening the popup via the new shortcut still needs a live check after Premiere restarts. The timeline insertion code is unchanged by this update.


In search results, Shift+click or Shift+Enter opens the selected media or sequence in the Source Monitor and closes the search popup on success. No active timeline is required. Regular click or Enter places media on the timeline. Bins cannot open in the Source Monitor.
