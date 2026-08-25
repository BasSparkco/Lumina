@echo off
REM Launches the Lumina player in a Chrome/Edge kiosk window on unattended signage hardware
REM (Windows mini-PC/kiosk box — no touchscreen/keyboard). See
REM apps\player\src\lib\audioUnlock.ts for why --autoplay-policy matters: without it, YouTube/video
REM content plays silently until someone taps the screen, which never happens on this hardware.

if "%PLAYER_URL%"=="" set PLAYER_URL=http://localhost:5000
if "%PROFILE_DIR%"=="" set PROFILE_DIR=%LOCALAPPDATA%\LuminaKiosk

set BROWSER=
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist %%B set BROWSER=%%B
)
if "%BROWSER%"=="" (
  echo No Chrome/Edge install found in the usual Program Files locations. 1>&2
  exit /b 1
)

"%BROWSER%" ^
  --kiosk "%PLAYER_URL%" ^
  --autoplay-policy=no-user-gesture-required ^
  --user-data-dir="%PROFILE_DIR%" ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-translate ^
  --overscroll-history-navigation=0 ^
  --check-for-update-interval=31536000
