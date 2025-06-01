@echo off
setlocal enabledelayedexpansion

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"
set "INI_FILE=%~dpn0.ini"
set "PALETTE=%TEMP%\vidlet_palette.png"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1.gif"

:: Default settings
set "fps=15"
set "width=480"
set "dither=sierra2_4a"
set "hidden_mode=0"
set "stats_mode=full"

:: Load settings from INI if available
if exist "!INI_FILE!" (
    for /f "tokens=*" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
        set "%%a"
    )
)

:: Check for FFmpeg
if not exist "!FFMPEG!" (
    color 0C
    echo Error: FFmpeg not found at "!FFMPEG!"
    goto :end_with_pause
)

:: Check for input file
if "%INPUT%"=="" (
    color 0C
    echo Error: No input file specified.
    echo Usage: togif.bat videofile.mp4
    goto :end_with_pause
)

if not exist "!INPUT!" (
    color 0C
    echo Error: Input file "!INPUT!" does not exist.
    goto :end_with_pause
)

echo MP4 to GIF Converter
echo.
echo Input: "!INPUT!"
echo Output: "!OUTPUT!"
echo.
echo Creating optimized palette...

:: Generate palette for better quality
"!FFMPEG!" -i "!INPUT!" -vf "fps=!fps!,scale=!width!:-1:flags=lanczos,palettegen=stats_mode=!stats_mode!" -y "!PALETTE!"

if !errorlevel! neq 0 (
    color 0C
    echo Error: Failed to generate palette.
    goto :cleanup
)

echo Converting to GIF...

:: Convert to GIF using the palette
"!FFMPEG!" -i "!INPUT!" -i "!PALETTE!" -lavfi "fps=!fps!,scale=!width!:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=!dither!" -y "!OUTPUT!"

if !errorlevel! neq 0 (
    color 0C
    echo Error: Conversion failed.
) else (
    color 0A
    echo Success! Output: "!OUTPUT!"
)

:cleanup
:: Clean up temporary files
if exist "!PALETTE!" del "!PALETTE!"

:end_with_pause
if not "!hidden_mode!"=="1" (
    echo.
    echo Press any key to exit...
    pause > nul
)

endlocal 