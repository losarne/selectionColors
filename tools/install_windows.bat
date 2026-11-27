@echo off
setlocal
title Selection Colors - installer
set "SRC=%~dp0SelectionColors"
set "DEST=%APPDATA%\Adobe\CEP\extensions\SelectionColors"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo Could not find "%SRC%". Unzip the whole folder first, then run this file again.
  pause
  exit /b 1
)

echo Enabling unsigned CEP extensions (PlayerDebugMode) for CSXS 9-14...
for %%V in (9 10 11 12 13 14) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

echo Copying extension to:
echo   %DEST%
if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo Copy failed. Close After Effects, Illustrator and InDesign and try again.
  pause
  exit /b 1
)

echo.
echo Done. Restart After Effects / Illustrator / InDesign, then open:
echo   Window ^> Extensions ^> Selection Colors
echo.
pause
