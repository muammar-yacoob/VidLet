@echo off
setlocal enabledelayedexpansion

:: Create a log file in a location we can definitely write to
set "LOG_FILE=%TEMP%\vidlet_thumb.log"
echo VidLet Thumbnail Tool started at %date% %time% > "!LOG_FILE!"

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

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

echo Video Thumbnail Tool
echo.
echo Input: "!INPUT!"
echo.
echo Select an image file for the thumbnail...

echo Showing file browser dialog >> "!LOG_FILE!"

:: Create temp file for image selection
set "TEMP_FILE=%TEMP%\vidlet_image_%RANDOM%.txt"

:: Create file browser dialog
echo powershell.exe -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Image files (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp'; $f.Title = 'Select Thumbnail Image'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('%TEMP_FILE%', $f.FileName) }" >> "!LOG_FILE!"

powershell.exe -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Image files (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp'; $f.Title = 'Select Thumbnail Image'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('%TEMP_FILE%', $f.FileName) }"

:: Check if user canceled
if not exist "!TEMP_FILE!" (
    echo User canceled image selection >> "!LOG_FILE!"
    color 0E
    echo Operation canceled. No image was selected.
    goto :end_with_pause
)

:: Read the selected image path
set "IMAGE_PATH="
for /f "usebackq delims=" %%i in ("!TEMP_FILE!") do (
    set "IMAGE_PATH=%%i"
    goto :got_path
)
:got_path

:: Delete temp file
del "!TEMP_FILE!" >nul 2>&1

echo Selected image: "!IMAGE_PATH!" >> "!LOG_FILE!"

:: Verify image path
if "!IMAGE_PATH!"=="" (
    color 0C
    echo Error: Failed to get image path. | tee -a "!LOG_FILE!"
    goto :end_with_pause
)

if not exist "!IMAGE_PATH!" (
    color 0C
    echo Error: Selected image "!IMAGE_PATH!" does not exist. | tee -a "!LOG_FILE!"
    goto :end_with_pause
)

echo Selected image: "!IMAGE_PATH!"
echo.

:: Delete existing output file
if exist "!OUTPUT!" (
    echo Deleting existing output file >> "!LOG_FILE!"
    del "!OUTPUT!" 
)

echo Processing video... Please wait.
echo Running FFMPEG command >> "!LOG_FILE!"

:: Apply thumbnail to video
"!FFMPEG!" -i "!INPUT!" -i "!IMAGE_PATH!" -map 0:v:0? -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic -loglevel warning "!OUTPUT!" 2>>"!LOG_FILE!"

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