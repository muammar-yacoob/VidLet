@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Default settings
set "default_bitrate=2500"
set "default_preset=medium"
set "preset_choice=6"
set "preset=medium"
set "non_interactive=0"

set "INPUT=%~1"
set "OUTPUT=%~dpn1_compressed.mp4"
set "INI_FILE=%~dpn0.ini"

:: Check if compress.ini exists in the same directory as the batch file
if exist "!INI_FILE!" (
    echo Using configuration from !INI_FILE!
    
    :: Read bitrate from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "bitrate=" "!INI_FILE!"') do (
        set "bitrate=%%a"
        set "non_interactive=1"
    )
    
    :: Read preset from INI
    for /f "tokens=2 delims==" %%a in ('findstr /b "preset=" "!INI_FILE!"') do (
        set "preset=%%a"
        set "non_interactive=1"
    )
    
    echo - Using bitrate: !bitrate! kb/s
    echo - Using preset: !preset!
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

:: Get basic info from input file
for /f "tokens=1-4 delims=:., " %%a in ('""%FFMPEG%" -i "!INPUT!" 2>&1 | find "Duration""') do (
    set "duration=%%b:%%c:%%d"
)

echo --------------------
echo Video Compression
echo --------------------
echo.
echo Input: "!INPUT!"
echo Duration: !duration!
echo.

:: Skip interactive prompts if we loaded from INI
if "!non_interactive!"=="0" (
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
)

echo.
echo Selected settings:
echo - Bitrate: !bitrate! kb/s
echo - Preset: !preset!
echo.

:: Delete existing output file if it exists
if exist "!OUTPUT!" del "!OUTPUT!"

echo Starting compression...
echo This may take a while, please wait...
echo.

:: Compress the video with specified settings
"!FFMPEG!" -i "!INPUT!" -c:v libx264 -b:v !bitrate!k -preset !preset! -c:a aac -b:a 128k -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check for errors
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo Error: Compression failed with error code %errorlevel%
    echo Please check that the input file exists and is a valid video file.
    echo.
    goto end
)

:: If we get here, compression was successful
color 0A
echo.
echo Compression complete!
echo Output saved as: !OUTPUT!

:: Force pause at the end
:end
echo Press any key to exit...
pause > nul
endlocal