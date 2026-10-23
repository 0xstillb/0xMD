#
# Capture a screenshot of the running 0xMD window.
#
#   powershell -ExecutionPolicy Bypass -File tools\screenshot.ps1 `
#     -File "E:\projects\MD Reader\demo\Welcome.md" `
#     -Folder "E:\projects\MD Reader\demo" `
#     -Out  "E:\projects\MD Reader\demo\0xmd-ui.png"
#

param(
  [string]$Exe    = "E:\projects\MD Reader\release\win-unpacked\0xMD.exe",
  [string]$File   = "",
  [string]$Folder = "",
  [string]$Out    = "E:\projects\MD Reader\demo\0xmd-ui.png",
  [int]$DelayMs   = 7000
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Shot {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@

# ---- launch -------------------------------------------------------------
$arguments = @()
if ($Folder) { $arguments += $Folder }
if ($File)   { $arguments += $File }

Write-Host "launching: $Exe $($arguments -join ' ')"
Start-Process -FilePath $Exe -ArgumentList $arguments | Out-Null

# ---- wait for the window ------------------------------------------------
$deadline = (Get-Date).AddSeconds(40)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 400
  foreach ($p in Get-Process -Name '0xMD' -ErrorAction SilentlyContinue) {
    if ($p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle; break }
  }
  if ($hwnd -ne [IntPtr]::Zero) { break }
}

if ($hwnd -eq [IntPtr]::Zero) { throw '0xMD window never appeared' }

Write-Host "window handle: $hwnd"

# Bring it to the front so the screen capture is not occluded.
[Shot]::ShowWindow($hwnd, 3) | Out-Null   # SW_MAXIMIZE
[Shot]::BringWindowToTop($hwnd) | Out-Null
[Shot]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 1500

# ---- capture ------------------------------------------------------------
$rect = New-Object Shot+RECT
[Shot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width  = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
Write-Host "window rect: $($rect.Left),$($rect.Top) ${width}x${height}"

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
$graphics.Dispose()

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Host "saved: $Out"
