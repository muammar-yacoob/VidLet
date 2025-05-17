@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"
set "TARGET_DURATION=59.5"
set "QUALITY=18"
set "PRESET=slow"
set "AUDIO_BITRATE=192"

set "INPUT=%~1"
set "OUTPUT=%~dpn1_59s.mp4"
set "INI_FILE=%~dpn0.ini"

:: Check if shrink.ini exists in the same directory as the batch file
if exist "!INI_FILE!" (
    echo Using configuration from !INI_FILE!
    
    :: Read target duration from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "target_duration=" "!INI_FILE!"') do (
        set "TARGET_DURATION=%%a"
    )
    
    :: Read quality from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "quality=" "!INI_FILE!"') do (
        set "QUALITY=%%a"
    )
    
    :: Read preset from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "preset=" "!INI_FILE!"') do (
        set "PRESET=%%a"
    )
    
    :: Read audio bitrate from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "audio_bitrate=" "!INI_FILE!"') do (
        set "AUDIO_BITRATE=%%a"
    )
    
    echo - Target Duration: !TARGET_DURATION! seconds
    echo - Video Quality (CRF): !QUALITY!
    echo - Preset: !PRESET!
    echo - Audio Bitrate: !AUDIO_BITRATE!k
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

:: Get video duration
set hh_str=0
set mm_str=0
set ss_str=0
set original_duration_seconds=0

echo Analyzing video duration...
for /f "tokens=1-4 delims=:., " %%a in ('""!FFMPEG!" -i "!INPUT!" 2>&1 | find "Duration""') do (
    if "%%b" NEQ "N/A" (
        set "hh_str=%%b"
        set "mm_str=%%c"
        set "ss_str=%%d"
        set "duration_display=%%b:%%c:%%d"
    )
)

if NOT "!duration_display!"=="N/A" (
    set /A hh_int = !hh_str! + 0
    set /A mm_int = !mm_str! + 0
    set /A ss_int_val = !ss_str! + 0
    set /a "original_duration_seconds = (hh_int * 3600) + (mm_int * 60) + ss_int_val"
) else (
    color 0C
    echo Error: Could not determine video duration.
    pause
    exit /b 1
)

echo --------------------
echo Video Shrinking
echo --------------------
echo.
echo Input: "!INPUT!"
echo Original Duration: !duration_display! (!original_duration_seconds!s)
echo Target Duration: !TARGET_DURATION!s
echo.

:: Check if video is already shorter than target
if !original_duration_seconds! LEQ !TARGET_DURATION! (
    color 0E
    echo.
    echo Video is already shorter than or equal to !TARGET_DURATION! seconds.
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

:: Delete existing output file if it exists
if exist "!OUTPUT!" del "!OUTPUT!"

echo.
echo Processing: "!INPUT!" to "!OUTPUT!"
echo This will create a !TARGET_DURATION! second version by increasing the speed.
echo Maintaining original video quality...
echo.

:: Process the video with speed change
:: Using high quality settings to preserve video quality
"!FFMPEG!" -i "!INPUT!" !speed_filters! -c:v libx264 -crf !QUALITY! -preset !PRESET! -c:a aac -b:a !AUDIO_BITRATE!k -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check for errors
if !errorlevel! neq 0 (
    color 0C
    echo.
    echo Error: Processing failed with error code !errorlevel!
    echo Please check that the input file exists and is a valid video file.
    echo.
    goto end
)

:: If we get here, processing was successful
color 0A
echo.
echo Success! Shrunk video saved as:
echo "!OUTPUT!"
echo.

:: Force pause at the end
:end
echo Press any key to exit...
pause > nul
endlocal 