@echo off
setlocal enabledelayedexpansion

:: For debugging - remove comment to see what's happening
:: set DEBUG=1

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Default settings
set "bitrate=2500"@echo off
COLOR 0E
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
COLOR 0A
echo.
echo Compression complete!
echo Output saved as: !output_file!
echo.

:: Force pause at the end
echo Press any key to exit...
pause > nul
endlocal
set "preset=medium"
set "hidden_mode=0"
set "non_interactive=0"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1_compressed.mp4"
set "INI_FILE=%~dpn0.ini"

:: Create a log file for debugging
if defined DEBUG (
    echo Starting compression script > "%TEMP%\compress_debug.log"
    echo Input file: "!INPUT!" >> "%TEMP%\compress_debug.log"
)

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
        echo Usage: compress.bat videofile.mp4
        echo This window will close in 10 seconds...
        timeout /t 10
        exit /b 1
    )
)

:: Load settings from INI if available
if exist "!INI_FILE!" (
    if defined DEBUG (
        echo Loading INI file: "!INI_FILE!" >> "%TEMP%\compress_debug.log"
    )
    
    for /f "tokens=*" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
        set "%%a"
        if defined DEBUG (
            echo Setting: %%a >> "%TEMP%\compress_debug.log"
        )
    )
    
    if defined bitrate (
        set "non_interactive=1"
        echo Using bitrate: !bitrate! kb/s
        if defined DEBUG (
            echo Using bitrate: !bitrate! kb/s >> "%TEMP%\compress_debug.log"
        )
    )
    
    if defined preset (
        set "non_interactive=1" 
        echo Using preset: !preset!
        if defined DEBUG (
            echo Using preset: !preset! >> "%TEMP%\compress_debug.log"
        )
    )
    
    :: If hidden mode is enabled and not already restarted, restart minimized
    if "!hidden_mode!"=="1" (
        if not defined IS_RESTARTED (
            if defined DEBUG (
                echo Starting minimized >> "%TEMP%\compress_debug.log"
            )
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

:: Show header
if "!non_interactive!"=="0" (
    echo --------------------
    echo Video Compression
    echo --------------------
    echo.
    echo Input: "!INPUT!"
    echo Duration: !duration!
    echo.
    
    :: Ask for bitrate
    echo Enter bitrate in kb/s (higher = better quality but larger file):
    echo Recommended: 2000-4000 for HD, 1500-2500 for SD
    set /p bitrate=Enter bitrate [!bitrate!]: 
    if "!bitrate!"=="" set "bitrate=2500"
    
    :: Ask for preset
    echo.
    echo Choose encoding preset (1-9):
    echo 1=ultrafast (fastest), 5=fast, 6=medium (default), 9=veryslow (best quality)
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
) else (
    echo Converting: "!INPUT!"
)

:: Remove existing output file
if exist "!OUTPUT!" del "!OUTPUT!"

:: Start compression
echo Processing... Please wait.
"!FFMPEG!" -i "!INPUT!" -c:v libx264 -b:v !bitrate!k -preset !preset! -c:a aac -b:a 128k -movflags +faststart -loglevel warning "!OUTPUT!"

:: Check result
if %errorlevel% neq 0 (
    color 0C
    echo Error: Compression failed.
    if defined DEBUG (
        echo Compression failed with error code %errorlevel% >> "%TEMP%\compress_debug.log"
    )
) else (
    color 0A
    echo Success! Output: "!OUTPUT!"
    if defined DEBUG (
        echo Compression succeeded: "!OUTPUT!" >> "%TEMP%\compress_debug.log"
    )
)

:: Exit
if "!non_interactive!"=="0" (
    echo.
    echo Press any key to exit...
    pause > nul
) else (
    :: If non-interactive but not hidden, pause briefly so user can see result
    if not "!hidden_mode!"=="1" (
        echo.
        echo This window will close in 5 seconds...
        timeout /t 5 > nul
    )
)

endlocal