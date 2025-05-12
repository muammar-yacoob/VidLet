@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

set "INPUT=%~1"
set "OUTPUT=%~dpn1.mp4"

:: Check if ffmpeg exists
if not exist "!FFMPEG!" (
    echo Error: FFmpeg not found at "!FFMPEG!"
    echo Please ensure FFmpeg is installed correctly.
    pause
    exit /b 1
)

:: Get duration of the input file (without using findstr)
for /f "tokens=1-4 delims=:., " %%a in ('""%FFMPEG%" -i "!INPUT!" 2>&1 | find "Duration""') do (
    set hours=%%b
    set mins=%%c
    set secs=%%d
    set "duration=%%b:%%c:%%d"
)
echo Input duration: !duration!

:: Delete existing output file if it exists
if exist "!OUTPUT!" del "!OUTPUT!"

:: Convert MKV to MP4 directly with minimal output
echo Converting MKV to MP4...
echo This may take a while, please wait...
echo.

:: Run FFmpeg directly (not in background)
"!FFMPEG!" -i "!INPUT!" -c:v copy -c:a copy -loglevel warning "!OUTPUT!"

:: Check if conversion was successful
if !errorlevel! equ 0 (
    echo.
    echo Conversion complete: !OUTPUT!
) else (
    echo.
    echo Error: Conversion failed with error code !errorlevel!
)

endlocal
echo.
echo Press any key to close this window...
pause > nul