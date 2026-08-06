@echo off
rem ==========================================================================
rem  NDP-Kit - installer launcher
rem
rem  IMPORTANT: keep this file 100%% ASCII. cmd.exe reads a .bat byte-by-byte
rem  using the console code page, so Thai text placed here makes its parser
rem  lose sync and run fragments of words as commands. All Thai UI text lives
rem  in ndp-kit-setup.ps1, which PowerShell reads with correct encoding.
rem
rem  Both files must stay in the same folder.
rem ==========================================================================
setlocal
set "PSFILE=%~dp0ndp-kit-setup.ps1"

if not exist "%PSFILE%" (
  echo.
  echo   ERROR: ndp-kit-setup.ps1 was not found next to this file.
  echo   Please copy BOTH files ^(ndp-kit-setup.bat and ndp-kit-setup.ps1^)
  echo   into the same folder, then run this again.
  echo.
  pause
  exit /b 1
)

set "PSEXE=powershell"
where pwsh >nul 2>&1 && set "PSEXE=pwsh"

"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%"
