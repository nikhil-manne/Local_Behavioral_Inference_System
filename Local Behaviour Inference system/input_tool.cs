using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
using System.Text;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Automation;

public class InputTool {
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll", CharSet = CharSet.Auto, ExactSpelling = true)]
    private static extern short GetKeyState(int keyCode);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;

    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_RBUTTONUP = 0x0205;

    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;

    private const uint KEYEVENTF_KEYDOWN = 0x0000;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    private static IntPtr _kbHook = IntPtr.Zero;
    private static IntPtr _mouseHook = IntPtr.Zero;
    private static LowLevelProc _kbProc = HookCallbackKB;
    private static LowLevelProc _mouseProc = HookCallbackMouse;

    private static bool _isLDown = false;
    private static bool _isRDown = false;
    private static int _startX = 0;
    private static int _startY = 0;
    private static long _downTime = 0;

    private static StringBuilder _textBuffer = new StringBuilder();
    private static System.Timers.Timer _typeTimer;
    private static readonly object _lock = new object();
    private static string _testProcessNameOverride = null;

    public static void Main(string[] args) {
        try {
            SetProcessDPIAware();
        } catch {}

        if (args.Length == 0) {
            PrintUsage();
            return;
        }

        string mode = args[0];
        try {
            if (mode == "--record") {
                StartRecord();
            } else if (mode == "--click") {
                int x = int.Parse(args[1]);
                int y = int.Parse(args[2]);
                string btn = args.Length > 3 ? args[3] : "left";
                SimulateClick(x, y, btn);
            } else if (mode == "--drag") {
                int x1 = int.Parse(args[1]);
                int y1 = int.Parse(args[2]);
                int x2 = int.Parse(args[3]);
                int y2 = int.Parse(args[4]);
                SimulateDrag(x1, y1, x2, y2);
            } else if (mode == "--type") {
                string text = string.Join(" ", args, 1, args.Length - 1);
                SimulateType(text);
            } else if (mode == "--key") {
                string key = args[1];
                int repeat = 1;
                if (args.Length > 2) {
                    int.TryParse(args[2], out repeat);
                }
                if (repeat < 1) repeat = 1;
                for (int i = 0; i < repeat; i++) {
                    SimulateKey(key);
                    if (repeat > 1) {
                        Thread.Sleep(50);
                    }
                }
            } else if (mode == "--focus") {
                int winX = -1, winY = -1, winW = -1, winH = -1;
                bool hasCoords = false;
                string title = "";
                
                if (args.Length >= 6) {
                    if (int.TryParse(args[args.Length - 4], out winX) &&
                        int.TryParse(args[args.Length - 3], out winY) &&
                        int.TryParse(args[args.Length - 2], out winW) &&
                        int.TryParse(args[args.Length - 1], out winH)) {
                        
                        hasCoords = true;
                        title = string.Join(" ", args, 1, args.Length - 5);
                    }
                }
                
                if (!hasCoords) {
                    title = string.Join(" ", args, 1, args.Length - 1);
                }
                
                FocusWindow(title, winX, winY, winW, winH);
            } else if (mode == "--get-rect") {
                string title = string.Join(" ", args, 1, args.Length - 1);
                GetWindowRectByTitle(title);
            } else if (mode == "--test") {
                RunSelfTests();
            } else {
                PrintUsage();
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
            Environment.Exit(1);
        }
    }

    private static void PrintUsage() {
        Console.WriteLine("  --record");
        Console.WriteLine("  --click <x> <y> [left|right]");
        Console.WriteLine("  --drag <x1> <y1> <x2> <y2>");
        Console.WriteLine("  --type <text>");
        Console.WriteLine("  --key <keyname>");
        Console.WriteLine("  --focus <title> [x y w h]");
        Console.WriteLine("  --get-rect <title>");
        Console.WriteLine("  --test");
    }

    private static void StartRecord() {
        _typeTimer = new System.Timers.Timer(2000);
        _typeTimer.Elapsed += (sender, e) => FlushTextBuffer();
        _typeTimer.AutoReset = false;

        _kbHook = SetHook(WH_KEYBOARD_LL, _kbProc);
        if (_kbHook == IntPtr.Zero) {
            Console.Error.WriteLine("Error: Failed to register low-level keyboard hook!");
        } else {
            Console.Error.WriteLine("Success: Registered keyboard hook.");
        }

        _mouseHook = SetHook(WH_MOUSE_LL, _mouseProc);
        if (_mouseHook == IntPtr.Zero) {
            Console.Error.WriteLine("Error: Failed to register low-level mouse hook!");
        } else {
            Console.Error.WriteLine("Success: Registered mouse hook.");
        }

        System.Windows.Forms.Application.Run();

        if (_kbHook != IntPtr.Zero) UnhookWindowsHookEx(_kbHook);
        if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
    }

    private static IntPtr SetHook(int idHook, LowLevelProc lpfn) {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            return SetWindowsHookEx(idHook, lpfn, GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    private static string GetActiveWindowTitle() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "";
            StringBuilder sb = new StringBuilder(256);
            if (GetWindowText(hwnd, sb, 256) > 0) {
                return sb.ToString();
            }
        } catch {}
        return "";
    }

    private static string GetActiveProcessName() {
        if (_testProcessNameOverride != null) return _testProcessNameOverride;
        try {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "";
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return "";
            using (Process proc = Process.GetProcessById((int)pid)) {
                return proc.ProcessName.ToLower();
            }
        } catch {
            return "";
        }
    }

    private static IntPtr HookCallbackKB(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            uint vk = kbd.vkCode;
            
            int eventType = (int)wParam;
            if (eventType == WM_KEYDOWN || eventType == WM_SYSKEYDOWN) {
                HandleKeyDown(vk);
            }
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static IntPtr HookCallbackMouse(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int eventType = (int)wParam;
            MSLLHOOKSTRUCT mouse = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));

            if (eventType == WM_LBUTTONDOWN) {
                _isLDown = true;
                _startX = mouse.pt.x;
                _startY = mouse.pt.y;
                _downTime = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
            } else if (eventType == WM_RBUTTONDOWN) {
                _isRDown = true;
                _startX = mouse.pt.x;
                _startY = mouse.pt.y;
                _downTime = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
            } else if (eventType == WM_LBUTTONUP && _isLDown) {
                _isLDown = false;
                HandleMouseUp(mouse.pt.x, mouse.pt.y, "left");
            } else if (eventType == WM_RBUTTONUP && _isRDown) {
                _isRDown = false;
                HandleMouseUp(mouse.pt.x, mouse.pt.y, "right");
            }
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static bool IsPointInTextField(int x, int y) {
        try {
            var pt = new System.Windows.Point(x, y);
            var element = AutomationElement.FromPoint(pt);
            if (element != null) {
                var controlType = element.Current.ControlType;
                if (controlType == ControlType.Edit || 
                    controlType == ControlType.Document || 
                    controlType == ControlType.ComboBox) {
                    return true;
                }

                object valPat;
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out valPat)) {
                    var vp = (ValuePattern)valPat;
                    if (!vp.Current.IsReadOnly) {
                        return true;
                    }
                }
                
                var parent = TreeWalker.ControlViewWalker.GetParent(element);
                while (parent != null) {
                    var parentType = parent.Current.ControlType;
                    if (parentType == ControlType.Edit || 
                        parentType == ControlType.Document ||
                        parentType == ControlType.ComboBox) {
                        return true;
                    }
                    if (parent.TryGetCurrentPattern(ValuePattern.Pattern, out valPat)) {
                        var vp = (ValuePattern)valPat;
                        if (!vp.Current.IsReadOnly) {
                            return true;
                        }
                    }
                    if (parentType == ControlType.Window) {
                        break;
                    }
                    parent = TreeWalker.ControlViewWalker.GetParent(parent);
                }
            }
        } catch (Exception) {
            // Ignore automation exceptions
        }
        return false;
    }

    private static void HandleMouseUp(int endX, int endY, string button) {
        long now = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
        long duration = now - _downTime;
        double dist = Math.Sqrt(Math.Pow(endX - _startX, 2) + Math.Pow(endY - _startY, 2));

        // Unconditionally flush the text buffer on any mouse click
        FlushTextBuffer();

        int startX_copy = _startX;
        int startY_copy = _startY;

        ThreadPool.QueueUserWorkItem((o) => {
            int winX = 0, winY = 0, winW = 0, winH = 0;
            string winProcess = "";
            string winTitle = "";
            try {
                IntPtr hwnd = GetForegroundWindow();
                if (hwnd != IntPtr.Zero) {
                    RECT rect;
                    if (GetWindowRect(hwnd, out rect)) {
                        winX = rect.Left;
                        winY = rect.Top;
                        winW = rect.Right - rect.Left;
                        winH = rect.Bottom - rect.Top;
                    }
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);
                    try {
                        using (Process p = Process.GetProcessById((int)pid)) {
                            winProcess = p.ProcessName;
                            winTitle = p.MainWindowTitle ?? "";
                        }
                    } catch {}
                    if (string.IsNullOrEmpty(winTitle)) {
                        StringBuilder sb = new StringBuilder(256);
                        GetWindowText(hwnd, sb, 256);
                        winTitle = sb.ToString();
                    }
                }
            } catch {}

            string procLower = (winProcess ?? "").ToLower();
            string titleLower = (winTitle ?? "").ToLower();
            if (procLower.Contains("electron") || titleLower.Contains("pulse overlay") || procLower.Contains("antigravity-ide") || procLower.Contains("antigravity ide")) {
                return; // Discard clicks inside control panel/overlay GUI
            }

            string escapedTitle = (winTitle ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
            string escapedProcess = (winProcess ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");

            if (dist < 10 && duration < 800) {
                Console.WriteLine("{{\"type\": \"mouse_click\", \"button\": \"{0}\", \"x\": {1}, \"y\": {2}, \"winX\": {3}, \"winY\": {4}, \"winW\": {5}, \"winH\": {6}, \"winProcess\": \"{7}\", \"winTitle\": \"{8}\"}}", 
                    button, endX, endY, winX, winY, winW, winH, escapedProcess, escapedTitle);
            } else {
                Console.WriteLine("{{\"type\": \"mouse_drag\", \"button\": \"{0}\", \"startX\": {1}, \"startY\": {2}, \"endX\": {3}, \"endY\": {4}, \"winX\": {5}, \"winY\": {6}, \"winW\": {7}, \"winH\": {8}, \"winProcess\": \"{9}\", \"winTitle\": \"{10}\"}}", 
                    button, startX_copy, startY_copy, endX, endY, winX, winY, winW, winH, escapedProcess, escapedTitle);
            }
            Console.Out.Flush();
        });
    }

    private static void HandleKeyDown(uint vk) {
        string activeTitle = GetActiveWindowTitle();
        if (activeTitle.Contains("Pulse Overlay") || activeTitle.Contains("Antigravity IDE")) {
            return; // Ignore key inputs inside control panel/overlay GUI
        }

        // Ignore modifier keys completely so they don't flush the buffer or log key press events
        if (vk == 0x10 || vk == 0x11 || vk == 0x12 || vk == 0x14 || // Shift, Ctrl, Alt, CapsLock
            vk == 0xA0 || vk == 0xA1 || vk == 0xA2 || vk == 0xA3 || // LShift, RShift, LCtrl, RCtrl
            vk == 0xA4 || vk == 0xA5) { // LAlt, RAlt
            return;
        }

        if (_typeTimer != null) _typeTimer.Stop();

        string keyName = GetKeyFriendlyName(vk);
        char c;
        bool isChar = IsCharacterKey(vk, out c);

        if (isChar) {
            lock (_lock) {
                _textBuffer.Append(c);
            }
            if (_typeTimer != null) _typeTimer.Start();
        } else if (vk == 0x08) { // Backspace
            bool bufferNotEmpty = false;
            lock (_lock) {
                if (_textBuffer.Length > 0) {
                    _textBuffer.Remove(_textBuffer.Length - 1, 1);
                    bufferNotEmpty = true;
                }
            }
            if (bufferNotEmpty) {
                if (_typeTimer != null) _typeTimer.Start(); // treat backspace as active typing, restart idle timer
            } else {
                FlushTextBuffer();
                ThreadPool.QueueUserWorkItem((o) => {
                    Console.WriteLine("{\"type\": \"key_press\", \"key\": \"backspace\"}");
                    Console.Out.Flush();
                });
            }
        } else {
            FlushTextBuffer();
            if (!string.IsNullOrEmpty(keyName)) {
                ThreadPool.QueueUserWorkItem((o) => {
                    string proc = GetActiveProcessName();
                    bool isTerminal = proc == "cmd" || proc == "powershell" || proc == "pwsh" || 
                                      proc == "windowsterminal" || proc == "conhost" || proc == "bash";
                    if (isTerminal && keyName.ToLower() == "enter") {
                        return;
                    }
                    Console.WriteLine("{{\"type\": \"key_press\", \"key\": \"{0}\"}}", keyName.ToLower());
                    Console.Out.Flush();
                });
            }
        }
    }

    private static void FlushTextBuffer() {
        string text = "";
        lock (_lock) {
            if (_textBuffer.Length > 0) {
                text = _textBuffer.ToString();
                _textBuffer.Clear();
            }
        }
        if (!string.IsNullOrEmpty(text)) {
            string text_copy = text;
            ThreadPool.QueueUserWorkItem((o) => {
                string proc = GetActiveProcessName();
                bool isTerminal = proc == "cmd" || proc == "powershell" || proc == "pwsh" || 
                                  proc == "windowsterminal" || proc == "conhost" || proc == "bash";
                if (isTerminal) {
                    Console.WriteLine("{{\"type\": \"terminal_command\", \"command\": \"{0}\"}}", EscapeJsonString(text_copy));
                } else {
                    Console.WriteLine("{{\"type\": \"key_sequence\", \"text\": \"{0}\"}}", EscapeJsonString(text_copy));
                }
                Console.Out.Flush();
            });
        }
    }

    private static string EscapeJsonString(string text) {
        return text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r");
    }

    private static bool IsCharacterKey(uint vk, out char c) {
        c = '\0';
        
        // If Control or Alt is held down, it's a shortcut/combo, not regular character typing
        bool ctrl = (GetKeyState(0x11) & 0x8000) != 0;
        bool alt = (GetKeyState(0x12) & 0x8000) != 0;
        if (ctrl || alt) {
            return false;
        }

        bool shift = (GetKeyState(0x10) & 0x8000) != 0;

        if (vk >= 0x30 && vk <= 0x39) {
            if (shift) {
                char[] shiftNumbers = { ')', '!', '@', '#', '$', '%', '^', '&', '*', '(' };
                c = shiftNumbers[vk - 0x30];
            } else {
                c = (char)('0' + (vk - 0x30));
            }
            return true;
        }
        if (vk >= 0x41 && vk <= 0x5A) {
            c = (char)(shift ? ('A' + (vk - 0x41)) : ('a' + (vk - 0x41)));
            return true;
        }
        switch (vk) {
            case 0x20: c = ' '; return true;
            case 0xBA: c = shift ? ':' : ';'; return true;
            case 0xBB: c = shift ? '+' : '='; return true;
            case 0xBC: c = shift ? '<' : ','; return true;
            case 0xBD: c = shift ? '_' : '-'; return true;
            case 0xBE: c = shift ? '>' : '.'; return true;
            case 0xBF: c = shift ? '?' : '/'; return true;
            case 0xC0: c = shift ? '~' : '`'; return true;
            case 0xDB: c = shift ? '{' : '['; return true;
            case 0xDC: c = shift ? '|' : '\\'; return true;
            case 0xDD: c = shift ? '}' : ']'; return true;
            case 0xDE: c = shift ? '"' : '\''; return true;
        }
        return false;
    }

    private static string GetKeyFriendlyName(uint vk) {
        switch (vk) {
            case 0x0D: return "Enter";
            case 0x09: return "Tab";
            case 0x1B: return "Escape";
            case 0x08: return "Backspace";
            case 0x2E: return "Delete";
            case 0x26: return "Up";
            case 0x28: return "Down";
            case 0x25: return "Left";
            case 0x27: return "Right";
            case 0x21: return "PageUp";
            case 0x22: return "PageDown";
            case 0x24: return "Home";
            case 0x23: return "End";
            case 0x2D: return "Insert";
            case 0x20: return "Space";
            case 0xB3: return "PlayPause";
            case 0xB2: return "Stop";
            case 0xB1: return "PrevTrack";
            case 0xB0: return "NextTrack";
            case 0xAF: return "VolumeUp";
            case 0xAE: return "VolumeDown";
            case 0xAD: return "VolumeMute";
            case 0x5B: return "LWin";
            case 0x5C: return "RWin";
        }
        return null;
    }

    private static void SimulateClick(int x, int y, string button) {
        SetCursorPos(x, y);
        Thread.Sleep(150);

        uint downFlag = MOUSEEVENTF_LEFTDOWN;
        uint upFlag = MOUSEEVENTF_LEFTUP;

        if (button == "right") {
            downFlag = MOUSEEVENTF_RIGHTDOWN;
            upFlag = MOUSEEVENTF_RIGHTUP;
        }

        INPUT[] downInput = new INPUT[1];
        downInput[0] = new INPUT { type = INPUT_MOUSE };
        downInput[0].U.mi.dwFlags = downFlag;
        SendInput(1, downInput, Marshal.SizeOf(typeof(INPUT)));

        Thread.Sleep(100);

        INPUT[] upInput = new INPUT[1];
        upInput[0] = new INPUT { type = INPUT_MOUSE };
        upInput[0].U.mi.dwFlags = upFlag;
        SendInput(1, upInput, Marshal.SizeOf(typeof(INPUT)));
    }

    private static void SimulateDrag(int x1, int y1, int x2, int y2) {
        SetCursorPos(x1, y1);
        Thread.Sleep(150);

        INPUT[] downInputs = new INPUT[1];
        downInputs[0] = new INPUT { type = INPUT_MOUSE };
        downInputs[0].U.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        SendInput(1, downInputs, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(150);

        int steps = 15;
        for (int i = 1; i <= steps; i++) {
            int cx = x1 + (x2 - x1) * i / steps;
            int cy = y1 + (y2 - y1) * i / steps;
            SetCursorPos(cx, cy);
            Thread.Sleep(15);
        }
        Thread.Sleep(150);

        INPUT[] upInputs = new INPUT[1];
        upInputs[0] = new INPUT { type = INPUT_MOUSE };
        upInputs[0].U.mi.dwFlags = MOUSEEVENTF_LEFTUP;
        SendInput(1, upInputs, Marshal.SizeOf(typeof(INPUT)));
    }

    private static void SimulateType(string text) {
        foreach (char c in text) {
            INPUT[] inputs = new INPUT[2];
            inputs[0] = new INPUT {
                type = INPUT_KEYBOARD,
                U = new InputUnion {
                    ki = new KEYBDINPUT {
                        wVk = 0,
                        wScan = (ushort)c,
                        dwFlags = KEYEVENTF_UNICODE,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
            inputs[1] = new INPUT {
                type = INPUT_KEYBOARD,
                U = new InputUnion {
                    ki = new KEYBDINPUT {
                        wVk = 0,
                        wScan = (ushort)c,
                        dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
            SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(20);
        }
    }

    private static ushort ResolveKeyNameToVk(string keyName) {
        switch (keyName.ToLower()) {
            case "enter": return 0x0D;
            case "tab": return 0x09;
            case "escape": return 0x1B;
            case "backspace": return 0x08;
            case "delete": return 0x2E;
            case "space": return 0x20;
            case "up": return 0x26;
            case "down": return 0x28;
            case "left": return 0x25;
            case "right": return 0x27;
            case "playpause": return 0xB3;
            case "volumeup": return 0xAF;
            case "volumedown": return 0xAE;
            case "volumemute": return 0xAD;
            case "lwin": return 0x5B;
            case "rwin": return 0x5C;
            case "win": return 0x5B;
        }
        return 0;
    }

    private static void SimulateKey(string keyName) {
        ushort vk = ResolveKeyNameToVk(keyName);

        if (vk == 0) return;

        INPUT[] inputs = new INPUT[2];
        inputs[0] = new INPUT { type = INPUT_KEYBOARD };
        inputs[0].U.ki.wVk = vk;
        inputs[0].U.ki.dwFlags = KEYEVENTF_KEYDOWN;

        inputs[1] = new INPUT { type = INPUT_KEYBOARD };
        inputs[1].U.ki.wVk = vk;
        inputs[1].U.ki.dwFlags = KEYEVENTF_KEYUP;

        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    private static void RunSelfTests() {
        Console.WriteLine("Running self tests...");
        
        // Test GetKeyFriendlyName
        string lwinName = GetKeyFriendlyName(0x5B);
        string rwinName = GetKeyFriendlyName(0x5C);
        Console.WriteLine("0x5B -> " + lwinName);
        Console.WriteLine("0x5C -> " + rwinName);
        
        if (lwinName != "LWin" || rwinName != "RWin") {
            Console.Error.WriteLine("FAILED friendly name check!");
            Environment.Exit(1);
        }
        
        // Test key simulation mapping
        ushort vkLWin = ResolveKeyNameToVk("lwin");
        ushort vkRWin = ResolveKeyNameToVk("rwin");
        ushort vkWin = ResolveKeyNameToVk("win");
        Console.WriteLine("lwin -> 0x" + vkLWin.ToString("X"));
        Console.WriteLine("rwin -> 0x" + vkRWin.ToString("X"));
        Console.WriteLine("win -> 0x" + vkWin.ToString("X"));
        
        if (vkLWin != 0x5B || vkRWin != 0x5C || vkWin != 0x5B) {
            Console.Error.WriteLine("FAILED key code resolution check!");
            Environment.Exit(1);
        }

        // Test Unified Terminal Command Logging in Terminal Context (powershell)
        Console.WriteLine("Testing terminal command logging in powershell context...");
        _testProcessNameOverride = "powershell";
        _textBuffer.Clear();
        
        var originalOut = Console.Out;
        string termOutput;
        using (var sw = new System.IO.StringWriter()) {
            Console.SetOut(sw);
            
            // Simulate typing "git status"
            // g (0x47), i (0x49), t (0x54), Space (0x20), s (0x53), t (0x54), a (0x41), t (0x54), u (0x55), s (0x53)
            uint[] vks = { 0x47, 0x49, 0x54, 0x20, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53 };
            foreach (var vk in vks) {
                HandleKeyDown(vk);
            }
            
            // Press Enter (0x0D) - this flushes and suppresses Enter key event
            HandleKeyDown(0x0D);
            
            Thread.Sleep(300);
            Console.SetOut(originalOut);
            termOutput = sw.ToString().Trim();
        }
        
        Console.WriteLine("Captured terminal output:\n" + termOutput);
        if (!termOutput.Contains("\"type\": \"terminal_command\"") || 
            !termOutput.Contains("\"command\": \"git status\"") || 
            termOutput.Contains("\"key\": \"enter\"")) {
            Console.Error.WriteLine("FAILED terminal command logging check!");
            Environment.Exit(1);
        }

        // Test Unified Terminal Command Logging in non-terminal Context (notepad)
        Console.WriteLine("Testing key sequence logging in notepad context...");
        _testProcessNameOverride = "notepad";
        _textBuffer.Clear();
        
        string notepadOutput;
        using (var sw = new System.IO.StringWriter()) {
            Console.SetOut(sw);
            
            uint[] vks = { 0x47, 0x49, 0x54, 0x20, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53 };
            foreach (var vk in vks) {
                HandleKeyDown(vk);
            }
            
            // Press Enter (0x0D) - this flushes notepad buffer and emits Enter press
            HandleKeyDown(0x0D);
            
            Thread.Sleep(300);
            Console.SetOut(originalOut);
            notepadOutput = sw.ToString().Trim();
        }
        
        Console.WriteLine("Captured notepad output:\n" + notepadOutput);
        if (!notepadOutput.Contains("\"type\": \"key_sequence\"") || 
            !notepadOutput.Contains("\"text\": \"git status\"") || 
            !notepadOutput.Contains("\"type\": \"key_press\"") || 
            !notepadOutput.Contains("\"key\": \"enter\"")) {
            Console.Error.WriteLine("FAILED key sequence logging check!");
            Environment.Exit(1);
        }
        
        _testProcessNameOverride = null;
        Console.WriteLine("All self tests passed!");
    }

    private static void FocusWindow(string title, int winX = -1, int winY = -1, int winW = -1, int winH = -1) {
        bool activated = false;
        try {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType != null) {
                object shell = Activator.CreateInstance(shellType);
                object result = shellType.InvokeMember("AppActivate", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { title });
                if (result != null && (bool)result) {
                    Console.WriteLine("Activated window via AppActivate COM: " + title);
                    activated = true;
                }
            }
        } catch {
            // Ignore COM errors
        }

        string titleLower = title.ToLower().Trim();
        string cleanName = titleLower.EndsWith(".exe") ? titleLower.Substring(0, titleLower.Length - 4) : titleLower;

        foreach (Process proc in Process.GetProcesses()) {
            try {
                string procNameLower = proc.ProcessName.ToLower();
                bool nameMatch = procNameLower.Contains(cleanName) || cleanName.Contains(procNameLower) || procNameLower.Contains(titleLower);
                string winTitle = proc.MainWindowTitle;
                bool titleMatch = !string.IsNullOrEmpty(winTitle) && (winTitle.ToLower().Contains(titleLower) || winTitle.ToLower().Contains(cleanName));

                if (nameMatch || titleMatch) {
                    IntPtr handle = proc.MainWindowHandle;
                    if (handle != IntPtr.Zero) {
                        // Always restore first if moving/resizing or if minimized
                        ShowWindowAsync(handle, 9); // SW_RESTORE
                        
                        if (winX != -1 && winY != -1 && winW > 0 && winH > 0) {
                            Console.WriteLine("Moving and resizing window: X=" + winX + " Y=" + winY + " W=" + winW + " H=" + winH);
                            MoveWindow(handle, winX, winY, winW, winH, true);
                        }
                        
                        BringWindowToTop(handle);
                        SetForegroundWindow(handle);
                        SwitchToThisWindow(handle, true);
                        Console.WriteLine("Restored, positioned/shown, and focused window (PID: " + proc.Id + ", Name: " + proc.ProcessName + ")");
                        return;
                    }
                }
            } catch {
                // Ignore process access exceptions
            }
        }

        // Fallback: Use EnumWindows to find window handles of UWP apps (like WhatsApp) hosted under ApplicationFrameHost or otherwise
        IntPtr fallbackHandle = IntPtr.Zero;
        string fallbackProcName = "";
        EnumWindows(delegate (IntPtr wnd, IntPtr param) {
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(wnd, sb, 256);
            string wTitle = sb.ToString().ToLower();
            
            uint pid;
            GetWindowThreadProcessId(wnd, out pid);
            string procName = "";
            try {
                procName = Process.GetProcessById((int)pid).ProcessName.ToLower();
            } catch {}

            if ((!string.IsNullOrEmpty(wTitle) && (wTitle.Contains(titleLower) || wTitle.Contains(cleanName))) || 
                (!string.IsNullOrEmpty(procName) && (procName.Contains(titleLower) || procName.Contains(cleanName)))) {
                
                // Ignore shell/background container windows that are visible but not actual app windows
                if (procName != "explorer" && procName != "shellexperiencehost" && wTitle != "program manager") {
                    fallbackHandle = wnd;
                    fallbackProcName = procName;
                    return false; // Stop enumeration
                }
            }
            return true; // Continue
        }, IntPtr.Zero);

        if (fallbackHandle != IntPtr.Zero) {
            Console.WriteLine("Found fallback window handle via EnumWindows: HWND=" + fallbackHandle + ", Process=" + fallbackProcName);
            ShowWindowAsync(fallbackHandle, 9); // SW_RESTORE
            
            if (winX != -1 && winY != -1 && winW > 0 && winH > 0) {
                Console.WriteLine("Moving and resizing window: X=" + winX + " Y=" + winY + " W=" + winW + " H=" + winH);
                MoveWindow(fallbackHandle, winX, winY, winW, winH, true);
            }
            
            BringWindowToTop(fallbackHandle);
            SetForegroundWindow(fallbackHandle);
            SwitchToThisWindow(fallbackHandle, true);
            Console.WriteLine("Restored, positioned/shown, and focused fallback window via EnumWindows");
            return;
        }

        if (activated) {
            return;
        }

        Console.Error.WriteLine("Window not found matching: " + title);
    }

    private static void GetWindowRectByTitle(string title) {
        string titleLower = title.ToLower();
        foreach (Process proc in Process.GetProcesses()) {
            try {
                bool nameMatch = proc.ProcessName.ToLower().Contains(titleLower);
                string winTitle = proc.MainWindowTitle;
                bool titleMatch = !string.IsNullOrEmpty(winTitle) && winTitle.ToLower().Contains(titleLower);

                if (nameMatch || titleMatch) {
                    IntPtr handle = proc.MainWindowHandle;
                    if (handle != IntPtr.Zero) {
                        RECT rect;
                        if (GetWindowRect(handle, out rect)) {
                            int w = rect.Right - rect.Left;
                            int h = rect.Bottom - rect.Top;
                            Console.WriteLine("{0},{1},{2},{3}", rect.Left, rect.Top, w, h);
                            return;
                        }
                    }
                }
            } catch {}
        }
        Console.WriteLine("0,0,0,0");
    }
}
