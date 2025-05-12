@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

set "INPUT=%~1"
set "OUTPUT=%~dpn1.mp4"

:: Delete existing output file if it exists
if exist "!OUTPUT!" del "!OUTPUT!"

:: Convert MKV to MP4 without changing quality
"%FFMPEG%" -i "!INPUT!" -c:v copy -c:a copy "!OUTPUT!"

echo Conversion complete: !OUTPUT!
pause 