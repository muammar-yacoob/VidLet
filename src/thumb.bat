@echo off
setlocal enabledelayedexpansion

:: Setup paths
set "ROOT_DIR=%ProgramFiles%\VidLet"
set "FFMPEG=%ROOT_DIR%\libs\ffmpeg.exe"

:: Get input file from command line
set "INPUT=%~1"
set "OUTPUT=%~dpn1_thumbed%~x1"

:: Start minimized but don't affect dialog windows
if not defined IS_MINIMIZED (
    set IS_MINIMIZED=1
    
    :: Create a VBS script to minimize current window
    echo Set WshShell = WScript.CreateObject("WScript.Shell")>"%TEMP%\minimize.vbs"
    echo WshShell.AppActivate WScript.Arguments(0)>>"%TEMP%\minimize.vbs"
    echo WScript.Sleep 500>>"%TEMP%\minimize.vbs"
    echo WshShell.SendKeys "% n">>"%TEMP%\minimize.vbs"
    
    :: Start regular version with flag but minimize window
    start cmd /c "%~f0" "%~1"
    
    :: Run the minimize script
    start /wait wscript "%TEMP%\minimize.vbs" "cmd.exe"
    del "%TEMP%\minimize.vbs"
    
    exit /b
)

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
    echo Usage: thumb.bat videofile.mp4
    pause
    exit /b 1
)

echo Video Thumbnail Tool
echo.
echo Input: "!INPUT!"
echo.
echo Select an image file for the thumbnail...

:: Create temp file for image selection
set "TEMP_FILE=%TEMP%\vidlet_image_%RANDOM%.txt"

:: Create file browser dialog - using ShowWindow to ensure it's visible
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Image files (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp'; $f.Title = 'Select Thumbnail Image'; $f.Multiselect = $false; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('%TEMP_FILE%', $f.FileName, [System.Text.Encoding]::ASCII) }"

:: Check if user canceled
if not exist "!TEMP_FILE!" (
    color 0E
    echo Operation canceled.
    pause
    exit /b 0
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

:: Verify image path
if "!IMAGE_PATH!"=="" (
    color 0C
    echo Error: Failed to get image path.
    pause
    exit /b 1
)

if not exist "!IMAGE_PATH!" (
    color 0C
    echo Error: Selected image does not exist.
    pause
    exit /b 1
)

echo Selected image: "!IMAGE_PATH!"
echo.

:: Delete existing output file
if exist "!OUTPUT!" del "!OUTPUT!"

echo Processing video... Please wait.

:: Apply thumbnail to video
"!FFMPEG!" -i "!INPUT!" -i "!IMAGE_PATH!" -map 0:v:0? -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic -loglevel warning "!OUTPUT!"

:: Check result
if !errorlevel! neq 0 (
    color 0C
    echo Error: Processing failed.
) else (
    color 0A
    echo Success! Output: "!OUTPUT!"
    
    echo Refreshing thumbnail cache...
    
    :: Create a temporary file with the same name but different extension
    set "TEMP_NAME=%~dpn1_thumbed_temp%~x1"
    
    :: Copy content to temp file
    copy /b "!OUTPUT!" "!TEMP_NAME!" >nul
    
    :: Delete original and rename temp back to original
    del "!OUTPUT!" >nul
    ren "!TEMP_NAME!" "%~nx1_thumbed%~x1" >nul
    
    :: Touch the file to update timestamps
    copy /b "!OUTPUT!"+"" "!OUTPUT!" >nul 2>&1
)

echo.
echo Press any key to exit...
pause > nul
endlocal 