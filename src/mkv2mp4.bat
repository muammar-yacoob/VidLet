@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"
set "USE_COPY=1"
set "PRESET=medium"
set "VIDEO_QUALITY=23"
set "AUDIO_BITRATE=128"

set "INPUT=%~1"
set "OUTPUT=%~dpn1.mp4"
set "INI_FILE=%~dpn0.ini"

:: Check if mkv2mp4.ini exists in the same directory as the batch file
if exist "!INI_FILE!" (
    echo Using configuration from !INI_FILE!
    
    :: Read conversion mode from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "use_copy=" "!INI_FILE!"') do (
        set "USE_COPY=%%a"
    )
    
    :: Read preset from INI (used when not copying)
    for /f "tokens=2 delims==" %%a in ('findstr /b "preset=" "!INI_FILE!"') do (
        set "PRESET=%%a"
    )
    
    :: Read video quality from INI (used when not copying)
    for /f "tokens=2 delims==" %%a in ('findstr /b "video_quality=" "!INI_FILE!"') do (
        set "VIDEO_QUALITY=%%a"
    )
    
    :: Read audio bitrate from INI (used when not copying)
    for /f "tokens=2 delims==" %%a in ('findstr /b "audio_bitrate=" "!INI_FILE!"') do (
        set "AUDIO_BITRATE=%%a"
    )
    
    echo - Stream copy mode: !USE_COPY!
    if "!USE_COPY!"=="0" (
        echo - Encoder preset: !PRESET!
        echo - Video quality (CRF): !VIDEO_QUALITY!
        echo - Audio bitrate: !AUDIO_BITRATE!k
    )
    echo.
)

:: Check if ffmpeg exists
if not exist "!FFMPEG!" (
    color 0C
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

:: Set conversion parameters based on copy mode
if "!USE_COPY!"=="1" (
    set "conversion_params=-c:v copy -c:a copy"
    echo Using stream copy (fastest, no quality loss)
) else (
    set "conversion_params=-c:v libx264 -crf !VIDEO_QUALITY! -preset !PRESET! -c:a aac -b:a !AUDIO_BITRATE!k"
    echo Using re-encoding (slower, but can fix compatibility issues)
)

:: Run FFmpeg directly (not in background)
"!FFMPEG!" -i "!INPUT!" !conversion_params! -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check if conversion was successful
if !errorlevel! equ 0 (
    color 0A
    echo.
    echo Conversion complete: !OUTPUT!
) else (
    color 0C
    echo.
    echo Error: Conversion failed with error code !errorlevel!
)

endlocal
echo.
echo Press any key to close this window...
pause > nul