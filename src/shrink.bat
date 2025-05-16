@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Default settings
set "default_bitrate=2500"

set "INPUT=%~1"
set "original_output_name_compressed=%~dpn1_compressed.mp4"
set "original_output_name_shortened=%~dpn1_compressed_shortened.mp4"

:: --- START: Added for video shortening feature ---
set hh_str=0
set mm_str=0
set ss_str=0
set original_duration_seconds=0
set duration_display="N/A"

:: Get original duration
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
    echo Warning: Could not determine video duration.
    set original_duration_seconds=0
)
:: --- END: Added for video shortening feature ---

:: Check if ffmpeg exists
if not exist "!FFMPEG!" (
    color 0C
    echo Error: FFmpeg not found at "!FFMPEG!"
    echo Please ensure FFmpeg is installed correctly.
    pause
    exit /b 1
)

echo --------------------
echo Video Compression and Shortening
echo --------------------
echo.
echo Input: "!INPUT!"
echo Duration: !duration_display! (!original_duration_seconds!s approx)
echo.

:: --- START: Logic for shortening and setting output/filters ---
set "shorten_opt=N"
set "speed_filters="
set "OUTPUT="

if !original_duration_seconds! GTR 0 (
    echo Do you want to shorten the video to 59.5 seconds by increasing its speed?
    set /p shorten_opt="(Y/N) [N]: "
    if /i "!shorten_opt!"=="Y" (
        if !original_duration_seconds! GTR 59 (
            set "speed_filters=-vf ""setpts=PTS*59.5/!original_duration_seconds!"" -af ""atempo=!original_duration_seconds!/59.5"""
            set "OUTPUT=!original_output_name_shortened!"
            echo Video will be shortened.
        ) else (
            echo Video duration (!original_duration_seconds!s) is already less than or equal to 59.5s.
            echo It will be compressed without shortening.
            set "OUTPUT=!original_output_name_compressed!"
        )
    ) else (
        echo Video will be compressed without shortening.
        set "OUTPUT=!original_output_name_compressed!"
    )
) else (
    echo Could not determine duration, cannot offer shortening. Compressing as is.
    set "OUTPUT=!original_output_name_compressed!"
)
:: --- END: Logic for shortening ---

echo.
echo --------------------
echo.
echo Bitrate determines the output file size and quality:
echo - Higher value = Better quality but larger file size
echo - Lower value = Smaller file size but lower quality
echo.
echo Recommended values:
echo - HD video (1080p): 2000-4000 kb/s
echo - SD video (720p): 1500-2500 kb/s
echo - Low resolution: 800-1500 kb/s
echo.
set /p bitrate=Enter bitrate in kb/s [%default_bitrate%]: 
if "!bitrate!"=="" set "bitrate=%default_bitrate%"

echo.
echo Available presets:
echo 1. ultrafast (Fastest, lowest quality)
echo 2. superfast
echo 3. veryfast
echo 4. faster
echo 5. fast
echo 6. medium (Default)
echo 7. slow
echo 8. slower
echo 9. veryslow (Slowest, highest quality)
echo.

set /p preset_choice=Choose preset [6]: 
if "!preset_choice!"=="" set "preset_choice=6"

if "!preset_choice!"=="1" set "preset=ultrafast"
if "!preset_choice!"=="2" set "preset=superfast"
if "!preset_choice!"=="3" set "preset=veryfast"
if "!preset_choice!"=="4" set "preset=faster"
if "!preset_choice!"=="5" set "preset=fast"
if "!preset_choice!"=="6" set "preset=medium"
if "!preset_choice!"=="7" set "preset=slow"
if "!preset_choice!"=="8" set "preset=slower"
if "!preset_choice!"=="9" set "preset=veryslow"

echo.
echo Selected settings:
echo - Output: !OUTPUT!
echo - Bitrate: !bitrate! kb/s
echo - Preset: !preset!
if defined speed_filters (
    echo - Shortening to 59.5s: Yes
) else (
    echo - Shortening to 59.5s: No
)
echo.

:: Delete existing output file if it exists
if exist "!OUTPUT!" del "!OUTPUT!"

echo Starting processing...
echo This may take a while, please wait...
echo.

:: Compress the video with specified settings
"!FFMPEG!" -i "!INPUT!" !speed_filters! -c:v libx264 -b:v !bitrate!k -preset !preset! -c:a aac -b:a 128k -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check for errors
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo Error: Processing failed with error code %errorlevel%
    echo Please check that the input file exists and is a valid video file.
    echo.
    goto end
)

:: If we get here, processing was successful
color 0A
echo.
echo Processing complete!
echo Output saved as: !OUTPUT!

:: Force pause at the end
:end
echo Press any key to exit...
pause > nul
endlocal 