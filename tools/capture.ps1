#
# Capture the screen area of a running window.
#
#   powershell -ExecutionPolicy Bypass -File tools\capture.ps1 -Out "shot.png"
#

param(
  [string]$ProcessName = '0xMD',
  [string]$Out         = "E:\projects\MD Reader\demo\0xmd-ui.png",
  [int]$DelayMs       = 1200,
  [int]$Width         = 1400,
  [int]$Height        = 940
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Cap {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
"@

$target = $null
foreach ($p in Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) {
  if ($p.MainWindowHandle -ne 0) { $target = $p; break }
}
if (-not $target) { throw "no window found for process '$ProcessName'" }

$hwnd = $target.MainWindowHandle
Write-Host "capturing window '$($target.MainWindowTitle)' ($hwnd)"

# Restore to a normal size and position it, then raise it so nothing
# occludes the capture.
[Cap]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
Start-Sleep -Milliseconds 400
[Cap]::SetWindowPos($hwnd, [IntPtr]::Zero, 80, 60, $Width, $Height, 0x0040) | Out-Null
[Cap]::BringWindowToTop($hwnd) | Out-Null
[Cap]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds $DelayMs

$rect = New-Object Cap+RECT
[Cap]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width  = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
Write-Host "rect: $($rect.Left),$($rect.Top) ${width}x${height}"

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# PrintWindow renders the window itself, so other windows on top cannot
# occlude the result. Fall back to a screen grab if it comes back blank.
$hdc = $graphics.GetHdc()
$printed = [Cap]::PrintWindow($hwnd, $hdc, 2)
$graphics.ReleaseHdc($hdc)

if (-not $printed) {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
}
$graphics.Dispose()

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Host "saved: $Out"
