@echo off
setlocal enabledelayedexpansion
color 0A

:: Set paths and create directories
set "CURRENT_DIR=%~dp0"
set "INSTALL_DIR=%ProgramFiles%\VidLet"

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    color 04
    echo Administrator privileges required!
    pause
    exit /b 1
)

echo ================================
echo   VidLet Video Tools Installer  
echo ================================
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" 2>nul
if not exist "%INSTALL_DIR%\src" mkdir "%INSTALL_DIR%\src" 2>nul
if not exist "%INSTALL_DIR%\src\icons" mkdir "%INSTALL_DIR%\src\icons" 2>nul
if not exist "%INSTALL_DIR%\libs" mkdir "%INSTALL_DIR%\libs" 2>nul

:: Copy files
echo Installing VidLet...

:: Suppress individual file copy messages
set "files_copied=0"
echo n | xcopy /y "%CURRENT_DIR%src\compress.bat" "%INSTALL_DIR%\src\" /i /q >nul && set /a "files_copied+=1"
echo n | xcopy /y "%CURRENT_DIR%src\mkv2mp4.bat" "%INSTALL_DIR%\src\" /i /q >nul && set /a "files_copied+=1"
echo n | xcopy /y "%CURRENT_DIR%src\shrink.bat" "%INSTALL_DIR%\src\" /i /q >nul && set /a "files_copied+=1"
echo n | xcopy /y "%CURRENT_DIR%src\thumb.bat" "%INSTALL_DIR%\src\" /i /q >nul && set /a "files_copied+=1"
echo n | xcopy /y "%CURRENT_DIR%src\compress.ini" "%INSTALL_DIR%\src\" /i /q >nul 2>nul
echo n | xcopy /y "%CURRENT_DIR%src\mkv2mp4.ini" "%INSTALL_DIR%\src\" /i /q >nul 2>nul
echo n | xcopy /y "%CURRENT_DIR%src\shrink.ini" "%INSTALL_DIR%\src\" /i /q >nul 2>nul
echo n | xcopy /y "%CURRENT_DIR%src\icons\*.ico" "%INSTALL_DIR%\src\icons\" /i /q >nul && set /a "files_copied+=2"
echo n | xcopy /y "%CURRENT_DIR%libs\ffmpeg.exe" "%INSTALL_DIR%\libs\" /i /q >nul && set /a "files_copied+=1"

echo %files_copied% files copied successfully.
echo.

:: Import registry file
echo Installing context menu integration...
reg import "%CURRENT_DIR%src\vidlet.reg" || (
    color 04
    echo Registry import failed! Path: "%CURRENT_DIR%src\vidlet.reg"
    pause
    exit /b 1
)

echo Installation complete
echo.
echo * MP4 compression
echo * MKV to MP4 conversion
echo * Video shrinking to 59.5 seconds
echo * Custom video thumbnail setting
echo.
echo VidLet has been successfully installed to %INSTALL_DIR%
echo.
echo How to use:
echo 1. Right-click on an MP4 file -^> Select "Compress Video"
echo 2. Right-click on an MKV file -^> Select "Convert to MP4"
echo 3. Right-click on an MP4 file -^> Select "Compress & Shorten Video (to 59.5s)"
echo 4. Right-click on an MP4 file -^> Select "Set Custom Thumbnail"
echo.
echo You may need to restart Windows Explorer for changes to take effect.

pause
endlocal 