@echo off
setlocal enabledelayedexpansion

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"
set "INI_FILE=%~dpn0.ini"
set "TEMP_DIR=%TEMP%\vidlet_loop"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1_loop%~x1"

:: Default settings
set "search_duration=5"
set "min_loop_length=1"
set "max_loop_length=3"
set "threshold=0.98"
set "crossfade=0.5"
set "hidden_mode=0"

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
    echo Usage: loop.bat videofile.mp4
    goto :end_with_pause
)

if not exist "!INPUT!" (
    color 0C
    echo Error: Input file "!INPUT!" does not exist.
    goto :end_with_pause
)

:: Create temp directory
if not exist "!TEMP_DIR!" mkdir "!TEMP_DIR!"

echo Perfect Loop Creator
echo.
echo Input: "!INPUT!"
echo.
echo Analyzing video for loop points...

:: Extract frames for analysis
"!FFMPEG!" -i "!INPUT!" -t !search_duration! -vf "fps=30,scale=64:64" -f image2 "!TEMP_DIR!\frame_%%d.jpg" -hide_banner -loglevel error

:: Find similar frames using Python script
python "%~dp0\scripts\find_loop.py" "!TEMP_DIR!" !min_loop_length! !max_loop_length! !threshold! > "!TEMP_DIR!\loop_points.txt"

:: Read loop points
for /f "tokens=1,2" %%a in ('type "!TEMP_DIR!\loop_points.txt"') do (
    set "start_time=%%a"
    set "end_time=%%b"
)

if not defined start_time (
    color 0C
    echo No suitable loop points found.
    goto :cleanup
)

echo Found loop points: !start_time!s to !end_time!s
echo Creating seamless loop...

:: Calculate duration
set /a "duration=end_time-start_time"

:: Create the loop with crossfade
"!FFMPEG!" -i "!INPUT!" -ss !start_time! -t !duration! -filter_complex "[0]split[first][second];[first]trim=0:!duration![t1];[second]trim=0:!duration!,tpad=start_duration=!duration![t2];[t1][t2]blend=all_expr='if(gte(T,B*!crossfade!),A,if(lte(T,B*(1-!crossfade!)),B,A*(1-T/(B*!crossfade!))+B*T/(B*!crossfade!)))'" -y "!OUTPUT!"

if !errorlevel! neq 0 (
    color 0C
    echo Error: Failed to create loop.
) else (
    color 0A
    echo Success! Output: "!OUTPUT!"
)

:cleanup
:: Clean up temp files
rd /s /q "!TEMP_DIR!" 2>nul

:end_with_pause
if not "!hidden_mode!"=="1" (
    echo.
    echo Press any key to exit...
    pause > nul
)

endlocal 