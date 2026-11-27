@echo off
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\SelectionColors"
if exist "%DEST%" (
  rmdir /s /q "%DEST%"
  echo Removed %DEST%
) else (
  echo Not installed.
)
echo PlayerDebugMode was left on, since other unsigned extensions may rely on it.
pause
