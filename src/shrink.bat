@echo off
setlocal enabledelayedexpansion

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Default settings
set "TARGET_DURATION=59.5"
set "QUALITY=18"
set "PRESET=slow"
set "AUDIO_BITRATE=192"
set "hidden_mode=0"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1_shrinked.mp4"
set "INI_FILE=%~dpn0.ini"

:: Check for FFmpeg
if not exist "!FFMPEG!" (
    color 0C
    echo Error: FFmpeg not found at "!FFMPEG!"
    pause
    exit /b 1
)

:: Check for input file
if "%INPUT%"=="" (
    color 0C
    echo Error: No input file specified.
    echo Usage: shrink.bat videofile.mp4
    pause
    exit /b 1
)

:: Load settings from INI if available
if exist "!INI_FILE!" (
    for /f "tokens=* delims=" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
        set "%%a"
    )
    
    echo Using settings from INI file
    echo - Target Duration: !TARGET_DURATION! seconds
    echo - Video Quality: !QUALITY!
    echo - Preset: !PRESET!
    echo - Audio Bitrate: !AUDIO_BITRATE!k
    
    :: If hidden mode is enabled, minimize the window
    if "!hidden_mode!"=="1" (
        start /min cmd /c "%~f0" "%~1"
        exit /b
    )
)

:: Get video duration
echo Analyzing video...
set original_duration_seconds=0

for /f "tokens=1-4 delims=:., " %%a in ('""!FFMPEG!" -i "!INPUT!" 2>&1 | find "Duration""') do (
    if "%%b" NEQ "N/A" (
        set "hh_str=%%b"
        set "mm_str=%%c"
        set "ss_str=%%d"
        set "duration_display=%%b:%%c:%%d"
        
        set /A hh_int = !hh_str! + 0
        set /A mm_int = !mm_str! + 0
        set /A ss_int_val = !ss_str! + 0
        set /a "original_duration_seconds = (hh_int * 3600) + (mm_int * 60) + ss_int_val"
    )
)

if "!original_duration_seconds!"=="0" (
    color 0C
    echo Error: Could not determine video duration.
    pause
    exit /b 1
)

echo Video Shrink Tool
echo.
echo Input: "!INPUT!"
echo Original Duration: !duration_display! (!original_duration_seconds!s)
echo Target Duration: !TARGET_DURATION!s
echo.

:: Check if video is already shorter than target
if !original_duration_seconds! LEQ !TARGET_DURATION! (
    color 0E
    echo Video is already shorter than target duration.
    echo No processing needed.
    pause
    exit /b 0
)

:: Calculate speed factor
set /a "speed_factor_int = (original_duration_seconds * 100) / (!TARGET_DURATION! * 10)"
set "speed_factor_decimal=!speed_factor_int:~0,-2!.!speed_factor_int:~-2!"
echo Speed factor: !speed_factor_decimal!x

:: Set ffmpeg filters for changing speed
set "speed_filters=-vf ""setpts=PTS*!TARGET_DURATION!/!original_duration_seconds!"" -af ""atempo=!original_duration_seconds!/!TARGET_DURATION!"""

:: Remove existing output file
if exist "!OUTPUT!" del "!OUTPUT!"

echo Processing... Please wait.

:: Process the video with speed change
"!FFMPEG!" -i "!INPUT!" !speed_filters! -c:v libx264 -crf !QUALITY! -preset !PRESET! -c:a aac -b:a !AUDIO_BITRATE!k -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check result
if !errorlevel! neq 0 (
    color 0C
    echo Error: Processing failed.
) else (
    color 0A
    echo Success! Output: "!OUTPUT!"
)

echo.
echo Press any key to exit...
pause > nul
endlocal 