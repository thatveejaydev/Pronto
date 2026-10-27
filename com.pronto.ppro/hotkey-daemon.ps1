param(
    [int]$Modifiers = 0,
    [int]$KeyCode = 0,
    [int]$OwnerPid = 0,
    [int]$PreviewModifiers = 0,
    [int]$PreviewKey = 0,
    [switch]$ValidateOnly,
    [switch]$Record
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class ChordRecorder {
    private readonly HashSet<int> pressedKeys = new HashSet<int>();
    public int CapturedModifiers;
    public int CapturedKey;
    public bool Completed;
    public bool Aborted;

    public static int DecodeModifierBit(int vk) {
        if (vk == 17 || vk == 162 || vk == 163) return 2; // Ctrl
        if (vk == 18 || vk == 164 || vk == 165) return 1; // Alt
        if (vk == 16 || vk == 160 || vk == 161) return 4; // Shift
        return 0;
    }

    public void OnKeyEvent(int vk, bool isKeyDown) {
        if (isKeyDown) {
            if (!pressedKeys.Add(vk)) return;
            if (vk == 27) {
                Aborted = true;
                return;
            }
            if (CapturedKey == 0 && !Aborted && DecodeModifierBit(vk) == 0) {
                int modMask = 0;
                bool singleTrigger = true;
                foreach (int held in pressedKeys) {
                    int bit = DecodeModifierBit(held);
                    modMask |= bit;
                    if (held != vk && bit == 0) singleTrigger = false;
                }
                if (singleTrigger && (modMask & 3) != 0 && ProntoHotkeyDaemon.IsAllowedTriggerKey(vk)) {
                    CapturedKey = vk;
                    CapturedModifiers = modMask;
                }
            }
        } else {
            pressedKeys.Remove(vk);
            if (pressedKeys.Count == 0 && (CapturedKey != 0 || Aborted)) {
                Completed = true;
            }
        }
    }
}

public static class ProntoHotkeyDaemon {
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMsg {
        public IntPtr Hwnd;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public NativePoint Pt;
        public uint Private;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out NativeMsg lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll")]
    private static extern uint MsgWaitForMultipleObjectsEx(uint nCount, IntPtr pHandles, uint dwMilliseconds, uint dwWakeMask, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public static bool IsAllowedTriggerKey(int vk) {
        return vk == 32 || (vk >= 65 && vk <= 90) || (vk >= 48 && vk <= 57) || (vk >= 112 && vk <= 122);
    }

    private static bool BelongsToPremiere(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        try {
            using (var proc = Process.GetProcessById((int)pid)) {
                return proc.ProcessName.Equals("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase);
            }
        } catch {
            return false;
        }
    }

    private static bool IsPremiereForeground() {
        IntPtr fg = GetForegroundWindow();
        return BelongsToPremiere(fg) || BelongsToPremiere(GetAncestor(fg, 3));
    }

    private static bool IsPaletteForeground() {
        if (!IsPremiereForeground()) return false;
        var sb = new StringBuilder(256);
        GetWindowText(GetForegroundWindow(), sb, sb.Capacity);
        return sb.ToString().Equals("PRONTO", StringComparison.OrdinalIgnoreCase);
    }

    private static void Emit(string token) {
        Console.WriteLine(token);
        Console.Out.Flush();
    }

    public static void ListenLoop(int modifiers, int key, int ownerPid, int previewMods, int previewKey) {
        if (key != 0 && (modifiers < 1 || modifiers > 7 || (modifiers & 3) == 0 || !IsAllowedTriggerKey(key))) {
            throw new ArgumentException("Shortcut requires Ctrl or Alt with A-Z, 0-9, Space, or F1-F11.");
        }

        bool openBound = false, openConflict = false;
        bool prevBound = false, prevConflict = false;
        bool shutdown = false;

        var stdinMonitor = new Thread(() => {
            try { while (Console.ReadLine() != null) {} } catch {}
            Volatile.Write(ref shutdown, true);
        });
        stdinMonitor.IsBackground = true;
        stdinMonitor.Start();

        Emit("STARTED");
        try {
            while (!Volatile.Read(ref shutdown)) {
                try {
                    if (Process.GetProcessById(ownerPid).HasExited) break;
                } catch {
                    break;
                }

                bool shouldBindOpen = key != 0 && IsPremiereForeground();
                if (shouldBindOpen && !openBound) {
                    openBound = RegisterHotKey(IntPtr.Zero, 101, (uint)modifiers | 0x4000u, (uint)key);
                    if (openBound) { openConflict = false; Emit("READY"); }
                    else if (!openConflict) { openConflict = true; Emit("CONFLICT"); }
                } else if (!shouldBindOpen && openBound) {
                    UnregisterHotKey(IntPtr.Zero, 101);
                    openBound = false;
                }

                bool shouldBindPreview = previewKey == 32 && previewMods > 0 && IsPaletteForeground();
                if (shouldBindPreview && !prevBound) {
                    prevBound = RegisterHotKey(IntPtr.Zero, 102, (uint)previewMods | 0x4000u, (uint)previewKey);
                    if (prevBound) { prevConflict = false; }
                    else if (!prevConflict) { prevConflict = true; Emit("PREVIEW_CONFLICT"); }
                } else if (!shouldBindPreview && prevBound) {
                    UnregisterHotKey(IntPtr.Zero, 102);
                    prevBound = false;
                }

                NativeMsg msg;
                while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) {
                    if (msg.Message == 0x0312) {
                        ulong hotkeyId = msg.WParam.ToUInt64();
                        if (hotkeyId == 101 && IsPremiereForeground()) Emit("OPEN");
                        else if (hotkeyId == 102 && IsPaletteForeground()) Emit("PREVIEW");
                    }
                }

                MsgWaitForMultipleObjectsEx(0, IntPtr.Zero, 75, 0x04FF, 0x0004);
            }
        } finally {
            if (openBound) UnregisterHotKey(IntPtr.Zero, 101);
            if (prevBound) UnregisterHotKey(IntPtr.Zero, 102);
        }
    }

    public static void CaptureChord(int ownerPid) {
        var recorder = new ChordRecorder();
        bool shutdown = false, unfocused = false;

        var stdinMonitor = new Thread(() => {
            try { while (Console.ReadLine() != null) {} } catch {}
            Volatile.Write(ref shutdown, true);
        });
        stdinMonitor.IsBackground = true;
        stdinMonitor.Start();

        LowLevelKeyboardProc hookProc = (nCode, wParam, lParam) => {
            if (nCode < 0) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
            if (!IsPremiereForeground()) {
                unfocused = true;
                return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
            }
            int msg = wParam.ToInt32();
            if (msg == 0x0100 || msg == 0x0104 || msg == 0x0101 || msg == 0x0105) {
                int vkCode = Marshal.ReadInt32(lParam);
                recorder.OnKeyEvent(vkCode, msg == 0x0100 || msg == 0x0104);
                return new IntPtr(1);
            }
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        };

        IntPtr hookHandle = SetWindowsHookEx(13, hookProc, GetModuleHandle(null), 0);
        if (hookHandle == IntPtr.Zero) {
            throw new InvalidOperationException("Failed to initialize keyboard hook: " + Marshal.GetLastWin32Error());
        }

        DateTime timeoutAt = DateTime.UtcNow.AddSeconds(20);
        try {
            Emit("LISTENING");
            while (!recorder.Completed && !unfocused && !Volatile.Read(ref shutdown) && DateTime.UtcNow < timeoutAt) {
                try {
                    if (Process.GetProcessById(ownerPid).HasExited) break;
                } catch {
                    break;
                }
                NativeMsg msg;
                while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) {}
                Thread.Sleep(10);
            }
        } finally {
            UnhookWindowsHookEx(hookHandle);
            GC.KeepAlive(hookProc);
        }

        if (recorder.Completed && !recorder.Aborted) {
            Emit("CAPTURE:" + recorder.CapturedModifiers + ":" + recorder.CapturedKey);
        } else {
            Emit("CANCEL");
        }
    }
}
'@

if ($ValidateOnly) {
    Write-Output 'PRONTO hotkey daemon compiled cleanly.'
    exit 0
}
if ($Record) {
    [ProntoHotkeyDaemon]::CaptureChord($OwnerPid)
} else {
    [ProntoHotkeyDaemon]::ListenLoop($Modifiers, $KeyCode, $OwnerPid, $PreviewModifiers, $PreviewKey)
}
