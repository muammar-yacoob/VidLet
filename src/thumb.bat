@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

set "INPUT=%~1"
set "OUTPUT=%~dpn1_thumbed%~x1"

:: Check if ffmpeg exists
if not exist "!FFMPEG!" (
    color 0C
    echo Error: FFmpeg not found at "!FFMPEG!"
    echo Please ensure FFmpeg is installed correctly.
    pause
    exit /b 1
)

:: Check if input file was provided
if "%INPUT%"=="" (
    color 0C
    echo Error: No input file specified.
    echo Usage: thumb.bat videofile.mp4
    pause
    exit /b 1
)

echo --------------------
echo Video Thumbnail Tool
echo --------------------
echo.
echo Input: "!INPUT!"
echo.
echo This tool will create a new video file with your custom thumbnail.
echo.
echo Please select an image file to use as the thumbnail...
echo.

:: Create a unique temp file name
set "TEMP_FILE=%TEMP%\vidlet_image_%RANDOM%.txt"

:: Use PowerShell to create a file browser dialog
:: Use -Encoding ASCII to avoid BOM issues
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Image files (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp'; $f.Title = 'Select Thumbnail Image'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('%TEMP_FILE%', $f.FileName, [System.Text.Encoding]::ASCII) }"

:: Check if user canceled the dialog
if not exist "!TEMP_FILE!" (
    color 0E
    echo.
    echo Operation canceled. No image was selected.
    pause
    exit /b 0
)

:: Read the selected image path more safely
set "IMAGE_PATH="
for /f "usebackq delims=" %%i in ("!TEMP_FILE!") do (
    set "IMAGE_PATH=%%i"
    goto :got_path
)
:got_path

:: Clean up temp file
del "!TEMP_FILE!" >nul 2>&1

:: Check if path is empty
if "!IMAGE_PATH!"=="" (
    color 0C
    echo.
    echo Error: Failed to obtain image path.
    pause
    exit /b 1
)

echo.
echo Selected image: "!IMAGE_PATH!"
echo.

:: Verify the image path exists
if not exist "!IMAGE_PATH!" (
    color 0C
    echo.
    echo Error: The selected image file does not exist.
    echo Path: "!IMAGE_PATH!"
    pause
    exit /b 1
)

:: Delete existing output file if it exists
if exist "!OUTPUT!" del "!OUTPUT!"

echo Processing video to add thumbnail...
echo Output will be saved as: "!OUTPUT!"
echo.

:: Apply the thumbnail to the video
:: Modified to explicitly map only the main video and audio streams, excluding any existing thumbnails
"!FFMPEG!" -i "!INPUT!" -i "!IMAGE_PATH!" -map 0:v:0? -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic -loglevel warning "!OUTPUT!"

:: Check for errors
if !errorlevel! neq 0 (
    color 0C
    echo.
    echo Error: Processing failed with error code !errorlevel!
    echo.
) else (
    color 0A
    echo.
    echo Success! Video with custom thumbnail saved as:
    echo "!OUTPUT!"
    echo.
    
    echo Refreshing thumbnail cache for this file...
    
    :: Create a temporary file with the same name but different extension
    set "TEMP_NAME=%~dpn1_thumbed_temp%~x1"
    
    :: Copy content to temp file
    copy /b "!OUTPUT!" "!TEMP_NAME!" >nul
    
    :: Delete original and rename temp back to original
    del "!OUTPUT!" >nul
    ren "!TEMP_NAME!" "%~nx1_thumbed%~x1" >nul
    
    :: Touch the file to update timestamps
    copy /b "!OUTPUT!"+"" "!OUTPUT!" >nul 2>&1
    
    echo Thumbnail cache refreshed.
)

echo Press any key to exit...
pause > nul
endlocal 