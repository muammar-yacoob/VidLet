@echo off
setlocal enabledelayedexpansion

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Default settings
set "USE_COPY=1"
set "PRESET=medium"
set "VIDEO_QUALITY=23"
set "AUDIO_BITRATE=128"
set "hidden_mode=0"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1.mp4"
set "INI_FILE=%~dpn0.ini"

:: Prevent immediate closing on error
if not defined IS_RESTARTED (
    :: Check for FFmpeg
    if not exist "!FFMPEG!" (
        color 0C
        echo Error: FFmpeg not found at "!FFMPEG!"
        echo This window will close in 10 seconds...
        timeout /t 10
        exit /b 1
    )
    
    :: Check for input file
    if "%INPUT%"=="" (
        color 0C
        echo Error: No input file specified.
        echo Usage: mkv2mp4.bat videofile.mkv
        echo This window will close in 10 seconds...
        timeout /t 10
        exit /b 1
    )
)

:: Load settings from INI if available
if exist "!INI_FILE!" (
    for /f "tokens=*" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
        set "%%a"
    )
    
    echo Using settings from INI file
    
    :: If hidden mode is enabled and not already restarted, restart minimized
    if "!hidden_mode!"=="1" (
        if not defined IS_RESTARTED (
            set IS_RESTARTED=1
            start /min cmd /c "%~f0" "%~1"
            exit /b
        )
    )
)

:: Mark as restarted to prevent recursive restarts
set "IS_RESTARTED=1"

:: Get video duration
for /f "tokens=1-4 delims=:., " %%a in ('""%FFMPEG%" -i "!INPUT!" 2>&1 | find "Duration""') do (
    set "duration=%%b:%%c:%%d"
)

:: Show info
echo Converting MKV to MP4
echo.
echo Input: "!INPUT!"
echo Duration: !duration!
echo.

if "!USE_COPY!"=="1" (
    echo Mode: Stream copy (fastest, no quality loss)
    set "conversion_params=-c:v copy -c:a copy"
) else (
    echo Mode: Re-encoding (fixes compatibility issues)
    echo - Video quality (CRF): !VIDEO_QUALITY!
    echo - Preset: !PRESET!
    echo - Audio bitrate: !AUDIO_BITRATE!k
    set "conversion_params=-c:v libx264 -crf !VIDEO_QUALITY! -preset !PRESET! -c:a aac -b:a !AUDIO_BITRATE!k"
)

:: Remove existing output file
if exist "!OUTPUT!" del "!OUTPUT!"

:: Convert the file
echo Processing... Please wait.
"!FFMPEG!" -i "!INPUT!" !conversion_params! -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check result
if !errorlevel! equ 0 (
    color 0A
    echo Success! Output: "!OUTPUT!"
) else (
    color 0C
    echo Error: Conversion failed.
)

:: If non-interactive but not hidden, pause briefly so user can see result
if not "!hidden_mode!"=="1" (
    echo.
    echo Press any key to exit...
    pause > nul
)

endlocal