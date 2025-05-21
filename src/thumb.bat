@echo off
setlocal enabledelayedexpansion

:: Create a log file in a location we can definitely write to
set "LOG_FILE=%TEMP%\vidlet_thumb.log"
echo VidLet Thumbnail Tool started at %date% %time% > "!LOG_FILE!"

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"
set "INI_FILE=%~dpn0.ini"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1_thumbed%~x1"

echo INPUT="!INPUT!" >> "!LOG_FILE!"
echo OUTPUT="!OUTPUT!" >> "!LOG_FILE!"

:: Check for FFmpeg
if not exist "!FFMPEG!" (
    color 0C
    echo Error: FFmpeg not found at "!FFMPEG!" | tee -a "!LOG_FILE!"
    echo This tool requires FFmpeg to be installed.
    goto :end_with_pause
)

:: Check for input file
if "%INPUT%"=="" (
    color 0C
    echo Error: No input file specified. | tee -a "!LOG_FILE!"
    echo Usage: thumb.bat videofile.mp4
    goto :end_with_pause
)

if not exist "!INPUT!" (
    color 0C
    echo Error: Input file "!INPUT!" does not exist. | tee -a "!LOG_FILE!"
    goto :end_with_pause
)

:: Get video duration
echo Getting video duration... >> "!LOG_FILE!"
set "duration_seconds=0"
for /f "tokens=1-4 delims=:., " %%a in ('""!FFMPEG!" -i "!INPUT!" 2>&1 | find "Duration""') do (
    if "%%b" NEQ "N/A" (
        set "hh_str=%%b"
        set "mm_str=%%c"
        set "ss_str=%%d"
        set "duration_display=%%b:%%c:%%d"
        
        set /A hh_int = !hh_str! + 0
        set /A mm_int = !mm_str! + 0
        set /A ss_int_val = !ss_str! + 0
        set /a "duration_seconds = (hh_int * 3600) + (mm_int * 60) + ss_int_val"
    )
)

if "!duration_seconds!"=="0" (
    color 0C
    echo Error: Could not determine video duration. | tee -a "!LOG_FILE!"
    goto :end_with_pause
)

echo Video duration: !duration_display! (!duration_seconds!s) >> "!LOG_FILE!"

:: Load INI settings
set "frame_timestamp=-1"
if exist "!INI_FILE!" (
    for /f "tokens=1,2 delims==" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
        if "%%a"=="frame_timestamp" set "frame_timestamp=%%b"
    )
)

echo Video Thumbnail Tool
echo.
echo Input: "!INPUT!"
echo Duration: !duration_display!
echo.

:: Handle frame selection
if "!frame_timestamp!"=="-1" (
    echo Enter timestamp for thumbnail (HH:MM:SS or seconds)...
    set /p "timestamp="
    
    :: Convert timestamp to seconds if in HH:MM:SS format
    set "frame_seconds=!timestamp!"
    echo !timestamp! | findstr /r "^[0-9][0-9]*:[0-9][0-9]:[0-9][0-9]$" >nul
    if not errorlevel 1 (
        for /f "tokens=1-3 delims=:" %%a in ("!timestamp!") do (
            set /a "frame_seconds = (%%a * 3600) + (%%b * 60) + %%c"
        )
    )
) else (
    set "frame_seconds=!frame_timestamp!"
)

:: Validate frame timestamp
if !frame_seconds! lss 0 (
    color 0C
    echo Error: Invalid timestamp. Must be greater than 0.
    goto :end_with_pause
)

if !frame_seconds! gtr !duration_seconds! (
    color 0C
    echo Error: Timestamp exceeds video duration.
    goto :end_with_pause
)

echo Using frame at !frame_seconds! seconds
echo.

:: Delete existing output file
if exist "!OUTPUT!" del "!OUTPUT!"

echo Processing video... Please wait.
echo Running FFMPEG command >> "!LOG_FILE!"

:: Extract frame and apply as thumbnail
"!FFMPEG!" -i "!INPUT!" -vf "select=eq(n\,!frame_seconds!*30)" -vframes 1 -f image2pipe -vcodec png - | "!FFMPEG!" -i "!INPUT!" -i - -map 0:v:0? -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic -loglevel warning "!OUTPUT!" 2>>"!LOG_FILE!"

:: Check result
if !errorlevel! neq 0 (
    color 0C
    echo Error: Processing failed with error code !errorlevel! | tee -a "!LOG_FILE!"
) else (
    color 0A
    echo Success! Output: "!OUTPUT!" | tee -a "!LOG_FILE!"
    
    echo Refreshing thumbnail cache... | tee -a "!LOG_FILE!"
    
    :: Create a temporary file with the same name but different extension
    set "TEMP_NAME=%~dpn1_thumbed_temp%~x1"
    
    :: Copy content to temp file
    copy /b "!OUTPUT!" "!TEMP_NAME!" >>"%TEMP%\vidlet_thumb_refresh.log" 2>&1
    
    :: Delete original and rename temp back to original
    del "!OUTPUT!" >>"%TEMP%\vidlet_thumb_refresh.log" 2>&1
    ren "!TEMP_NAME!" "%~nx1_thumbed%~x1" >>"%TEMP%\vidlet_thumb_refresh.log" 2>&1
    
    :: Touch the file to update timestamps
    copy /b "!OUTPUT!"+"" "!OUTPUT!" >>"%TEMP%\vidlet_thumb_refresh.log" 2>&1
    
    echo Thumbnail cache refreshed. | tee -a "!LOG_FILE!"
)

:end_with_pause
echo.
echo Log file created at: "!LOG_FILE!"
echo.
echo Press any key to exit...
pause > nul
echo User pressed a key to exit >> "!LOG_FILE!"
endlocal 