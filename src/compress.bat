@echo off
setlocal enabledelayedexpansion

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Default settings
set "bitrate=2500"
set "preset=medium"
set "hidden_mode=0"
set "non_interactive=0"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1_compressed.mp4"
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
    echo Usage: compress.bat videofile.mp4
    pause
    exit /b 1
)

:: Load settings from INI if available
if exist "!INI_FILE!" (
    for /f "tokens=* delims=" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
        set "%%a"
    )
    
    if defined bitrate (
        set "non_interactive=1"
        echo Using bitrate: !bitrate! kb/s
    )
    
    if defined preset (
        set "non_interactive=1" 
        echo Using preset: !preset!
    )
    
    :: If hidden mode is enabled, minimize the window
    if "!hidden_mode!"=="1" (
        start /min cmd /c "%~f0" "%~1"
        exit /b
    )
)

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
) else (
    color 0A
    echo Success! Output: "!OUTPUT!"
)

:: Exit
if "!non_interactive!"=="0" (
    echo Press any key to exit...
    pause > nul
)
endlocal