@echo off
setlocal enabledelayedexpansion

set "input_file=%~1"
set "default_bitrate=1500"
set "default_preset=medium"
set "ffmpeg_exe=%ProgramFiles%\VidLet\libs\ffmpeg.exe"

:: Check if ffmpeg exists
if not exist "!ffmpeg_exe!" (
    echo Error: FFmpeg not found at "!ffmpeg_exe!"
    echo Please ensure FFmpeg is installed correctly.
    pause
    exit /b 1
)

:: Simple input prompt in console instead of GUI
echo.
echo Compression Settings:
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
echo - Bitrate: !bitrate! kb/s
echo - Preset: !preset!
echo.

:: Create output filename
set "output_file=%~d1%~p1%~n1_compressed.mp4"

:: Compress the video
echo Compressing video...
echo This may take a while, please wait...
echo.

:: Run one-pass compression if quality is more important than speed
"!ffmpeg_exe!" -i "!input_file!" -c:v libx264 -preset !preset! -b:v !bitrate!k -c:a aac -b:a 128k -loglevel warning "!output_file!" || (
    echo.
    echo Error: Compression failed!
    echo.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

:: If we get here, compression was successful
echo.
echo Compression complete!
echo Output saved as: !output_file!
echo.

:: Force pause at the end
echo Press any key to exit...
pause > nul
endlocal