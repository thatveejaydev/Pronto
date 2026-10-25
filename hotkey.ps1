param([int]$Modifiers = 3, [int]$KeyCode = 66, [int]$OwnerPid = 0, [switch]$ValidateOnly, [switch]$Record)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;
public class ShortcutCapture {
    readonly HashSet<int> held = new HashSet<int>();
    public int Modifiers, Key;
    public bool Done, Cancelled;
    public static int Modifier(int k) {
        if (k == 17 || k == 162 || k == 163) return 2;
        if (k == 18 || k == 164 || k == 165) return 1;
        if (k == 16 || k == 160 || k == 161) return 4;
        return 0;
    }
    public bool Feed(int k, bool down) {
        if (down) {
            if (!held.Add(k)) return true;
            if (k == 27) { Cancelled = true; }
            else if (Key == 0 && !Cancelled && Modifier(k) == 0) {
                int mods = 0; bool valid = true;
                foreach (int v in held) { mods |= Modifier(v); if (v != k && Modifier(v) == 0) valid = false; }
                if (valid && (mods & 3) != 0 && BinSearchHotkey.SupportedKey(k)) { Key = k; Modifiers = mods; }
            }
        } else {
            held.Remove(k);
            if (held.Count == 0 && (Key != 0 || Cancelled)) Done = true;
        }
        return true;
    }
}
public static class BinSearchHotkey {
    delegate IntPtr KeyboardProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type, KeyboardProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
    public static bool SupportedKey(int key) { return key == 32 || (key >= 65 && key <= 90) || (key >= 48 && key <= 57) || (key >= 112 && key <= 122); }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; public uint lPrivate; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr h, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjectsEx(uint count, IntPtr handles, uint milliseconds, uint wakeMask, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    static bool PremiereActive() {
        uint id; GetWindowThreadProcessId(GetForegroundWindow(), out id);
        try { return Process.GetProcessById((int)id).ProcessName.Equals("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }
    static void Say(string value) { Console.WriteLine(value); Console.Out.Flush(); }
    public static void Run(int modifiers, int key, int owner) {
        if (modifiers < 1 || modifiers > 7 || (modifiers & 3) == 0 ||
            !SupportedKey(key))
            throw new ArgumentException("Use Ctrl or Alt with a letter, number, Space, or F1-F11.");
        bool registered = false, conflict = false;
        // Closing the CEP pipe or owner process stops this helper without leaving a resident service.
        bool stopped = false;
        var reader = new Thread(() => { try { while (Console.ReadLine() != null) {} } catch {} Volatile.Write(ref stopped, true); });
        reader.IsBackground = true; reader.Start();
        Say("STARTED");
        try {
            while (!Volatile.Read(ref stopped)) {
                try { if (Process.GetProcessById(owner).HasExited) break; } catch { break; }
                bool active = PremiereActive();
                if (active && !registered) {
                    registered = RegisterHotKey(IntPtr.Zero, 1, (uint)modifiers | 0x4000, (uint)key);
                    if (registered) { conflict = false; Say("READY"); }
                    else if (!conflict) { conflict = true; Say("CONFLICT"); }
                } else if (!active && registered) {
                    UnregisterHotKey(IntPtr.Zero, 1); registered = false;
                }
                MSG msg;
                while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) {
                    if (msg.message == 0x0312 && PremiereActive()) Say("OPEN");
                }
                // Wake immediately for WM_HOTKEY; timeout only rechecks foreground/owner.
                MsgWaitForMultipleObjectsEx(0, IntPtr.Zero, 75, 0x04FF, 0x0004);
            }
        } finally { if (registered) UnregisterHotKey(IntPtr.Zero, 1); }
    }
    public static void Record(int owner) {
        var capture = new ShortcutCapture();
        bool stopped = false, lostFocus = false;
        var reader = new Thread(() => { try { while (Console.ReadLine() != null) {} } catch {} Volatile.Write(ref stopped, true); });
        reader.IsBackground = true; reader.Start();
        // Hook exists only during explicit recording; no keys or text are logged.
        KeyboardProc callback = (code, message, data) => {
            if (code < 0) return CallNextHookEx(IntPtr.Zero, code, message, data);
            if (!PremiereActive()) { lostFocus = true; return CallNextHookEx(IntPtr.Zero, code, message, data); }
            int msg = message.ToInt32();
            if (msg == 0x100 || msg == 0x104 || msg == 0x101 || msg == 0x105) {
                capture.Feed(Marshal.ReadInt32(data), msg == 0x100 || msg == 0x104);
                return new IntPtr(1); // Prevent Alt+Space from opening the system menu while recording.
            }
            return CallNextHookEx(IntPtr.Zero, code, message, data);
        };
        IntPtr hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) throw new InvalidOperationException("Cannot start shortcut recorder: " + Marshal.GetLastWin32Error());
        DateTime deadline = DateTime.UtcNow.AddSeconds(20);
        try {
            Say("LISTENING");
            while (!capture.Done && !lostFocus && !Volatile.Read(ref stopped) && DateTime.UtcNow < deadline) {
                try { if (Process.GetProcessById(owner).HasExited) break; } catch { break; }
                MSG msg; while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) {}
                Thread.Sleep(10);
            }
        } finally { UnhookWindowsHookEx(hook); GC.KeepAlive(callback); }
        // Waited for release of the whole chord before registering the new shortcut.
        if (capture.Done && !capture.Cancelled) Say("CAPTURE:" + capture.Modifiers + ":" + capture.Key);
        else Say("CANCEL");
    }
}
'@
if ($ValidateOnly) { Write-Output 'Shortcut helper compiled successfully.'; exit 0 }
if ($Record) { [BinSearchHotkey]::Record($OwnerPid) }
else { [BinSearchHotkey]::Run($Modifiers, $KeyCode, $OwnerPid) }
