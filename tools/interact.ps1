#
# Click / scroll inside the running 0xMD window and capture the result.
#
#   powershell -ExecutionPolicy Bypass -File tools\interact.ps1 `
#     -ClickX 700 -ClickY 400 -PageDown 3 -Out "shot.png"
#

param(
  [string]$ProcessName = 'electron',
  [string]$Out         = "E:\projects\MD Reader\demo\0xmd-ui-2.png",
  [int]$ClickX        = -1,
  [int]$ClickY        = -1,
  [int]$PageDown      = 0,
  [int]$Scroll        = 0,
  [string]$SendKeys   = '',
  [int]$Width         = 1400,
  [int]$Height        = 940,
  [int]$DelayMs       = 1200
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Inter {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$target = $null
foreach ($p in Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) {
  if ($p.MainWindowHandle -ne 0) { $target = $p; break }
}
if (-not $target) { throw "no window found for '$ProcessName'" }

$hwnd = $target.MainWindowHandle
[Inter]::ShowWindow($hwnd, 9) | Out-Null
Start-Sleep -Milliseconds 300
[Inter]::SetWindowPos($hwnd, [IntPtr]::Zero, 80, 60, $Width, $Height, 0x0040) | Out-Null
[Inter]::BringWindowToTop($hwnd) | Out-Null
[Inter]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 900

$rect = New-Object Inter+RECT
[Inter]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

if ($ClickX -ge 0) {
  $sx = $rect.Left + $ClickX
  $sy = $rect.Top + $ClickY
  [Inter]::SetCursorPos($sx, $sy) | Out-Null
  Start-Sleep -Milliseconds 250
  [Inter]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # LEFTDOWN
  [Inter]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)   # LEFTUP
  Start-Sleep -Milliseconds 400
  Write-Host "clicked at $sx,$sy"
}

if ($PageDown -ge 0) {
  for ($i = 0; $i -lt $PageDown; $i++) {
    [Inter]::keybd_event(0x22, 0, 0, [UIntPtr]::Zero)        # VK_PAGEDOWN down
    [Inter]::keybd_event(0x22, 0, 2, [UIntPtr]::Zero)        # up
    Start-Sleep -Milliseconds 700
  }
} else {
  for ($i = 0; $i -gt $PageDown; $i--) {
    [Inter]::keybd_event(0x21, 0, 0, [UIntPtr]::Zero)        # VK_PAGEUP down
    [Inter]::keybd_event(0x21, 0, 2, [UIntPtr]::Zero)        # up
    Start-Sleep -Milliseconds 700
  }
}

if ($Scroll -ne 0) {
  # Mouse wheel over the editor; 120 units ≈ one notch.
  $sx = $rect.Left + [int]($Width / 2)
  $sy = $rect.Top + [int]($Height / 2)
  [Inter]::SetCursorPos($sx, $sy) | Out-Null
  Start-Sleep -Milliseconds 200
  $notches = [Math]::Abs($Scroll)
  $delta = if ($Scroll -gt 0) { -120 } else { 120 }
  for ($i = 0; $i -lt $notches; $i++) {
    [Inter]::mouse_event(0x0800, 0, 0, [uint32]([int]$delta), [UIntPtr]::Zero)  # MOUSEEVENTF_WHEEL
    Start-Sleep -Milliseconds 160
  }
  Write-Host "scrolled $notches notches"
}

if ($SendKeys) {
  # Make sure the keystroke lands in our window and not in whatever else
  # happens to be in front.
  for ($try = 0; $try -lt 5; $try++) {
    [Inter]::BringWindowToTop($hwnd) | Out-Null
    [Inter]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 350
    if ([Inter]::GetForegroundWindow() -eq $hwnd) { break }
  }
  [System.Windows.Forms.SendKeys]::SendWait($SendKeys)
  Write-Host "sent keys: $SendKeys (foreground match: $([Inter]::GetForegroundWindow() -eq $hwnd))"
  Start-Sleep -Milliseconds 1400
}

Start-Sleep -Milliseconds $DelayMs

$bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

$hdc = $graphics.GetHdc()
$printed = [Inter]::PrintWindow($hwnd, $hdc, 2)
$graphics.ReleaseHdc($hdc)
if (-not $printed) {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($Width, $Height)))
}
$graphics.Dispose()

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Host "saved: $Out"
