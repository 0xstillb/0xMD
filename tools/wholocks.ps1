#
# Find the process that holds a file open (Windows Restart Manager API).
#
#   powershell -ExecutionPolicy Bypass -File tools\wholocks.ps1 "path\to\file"
#

param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class LockFinder {
  const int RmRebootReasonNone = 0;
  const int CCH_RM_MAX_APP_NAME = 255;
  const int CCH_RM_MAX_SVC_NAME = 63;

  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
    public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
    public string strServiceShortName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bRestartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
    uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded,
    ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint pSessionHandle);

  public static List<string> WhoLocks(string path) {
    var result = new List<string>();
    uint handle;
    string key = Guid.NewGuid().ToString();
    int res = RmStartSession(out handle, 0, key);
    if (res != 0) { result.Add("RmStartSession failed: " + res); return result; }

    try {
      string[] resources = new string[] { path };
      res = RmRegisterResources(handle, 1, resources, 0, null, 0, null);
      if (res != 0) { result.Add("RmRegisterResources failed: " + res); return result; }

      uint needed = 0, count = 0, reasons = RmRebootReasonNone;
      res = RmGetList(handle, out needed, ref count, null, ref reasons);
      if (res == 234 && needed > 0) {
        var infos = new RM_PROCESS_INFO[needed];
        count = needed;
        res = RmGetList(handle, out needed, ref count, infos, ref reasons);
        if (res == 0) {
          for (int i = 0; i < count; i++) {
            string name = infos[i].strAppName;
            int pid = infos[i].Process.dwProcessId;
            string exe = "";
            try { exe = Process.GetProcessById(pid).MainModule.FileName; } catch { }
            result.Add(pid + " | " + name + " | " + exe);
          }
        }
      } else if (res == 0) {
        result.Add("(no process holds it)");
      } else {
        result.Add("RmGetList failed: " + res);
      }
    } finally {
      RmEndSession(handle);
    }
    return result;
  }
}
"@

$full = (Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue)
if (-not $full) { $full = $Path }

Write-Host "looking for lockers of: $full"
[LockFinder]::WhoLocks($full) | ForEach-Object { Write-Host "  $_" }
