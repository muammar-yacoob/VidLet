@echo off
setlocal enabledelayedexpansion
color 0A

echo ================================
echo   VidLet Video Tools Installer  
echo ================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    color 04
    echo Administrator privileges required!
    pause
    exit /b 1
)

:: Set paths and create directories
set "CURRENT_DIR=%~dp0"
set "INSTALL_DIR=%ProgramFiles%\VidLet"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" 2>nul
if not exist "%INSTALL_DIR%\src" mkdir "%INSTALL_DIR%\src" 2>nul
if not exist "%INSTALL_DIR%\src\icons" mkdir "%INSTALL_DIR%\src\icons" 2>nul
if not exist "%INSTALL_DIR%\libs" mkdir "%INSTALL_DIR%\libs" 2>nul

:: Copy files
color 0E
echo Installing VidLet...
color 0A

:: Suppress individual file copy messages
set "files_copied=0"
echo n | xcopy /y "%CURRENT_DIR%src\compress.bat" "%INSTALL_DIR%\src\" /i /q >nul && set /a "files_copied+=1"
echo n | xcopy /y "%CURRENT_DIR%src\mkv2mp4.bat" "%INSTALL_DIR%\src\" /i /q >nul && set /a "files_copied+=1"
echo n | xcopy /y "%CURRENT_DIR%src\icons\*.ico" "%INSTALL_DIR%\src\icons\" /i /q >nul && set /a "files_copied+=2"
echo n | xcopy /y "%CURRENT_DIR%libs\ffmpeg.exe" "%INSTALL_DIR%\libs\" /i /q >nul && set /a "files_copied+=1"

echo %files_copied% files copied successfully.

:: Import registry
reg import "%CURRENT_DIR%\src\vidlet.reg" >nul 2>&1 || (
    color 4F
    echo Registry import failed!
    pause
    exit /b 1
)

echo.
color 0A
echo Installation complete!
echo.
color 0B
echo * MP4 compression
echo * MKV to MP4 conversion
color 0A
echo.
echo VidLet has been successfully installed to %INSTALL_DIR%!
echo.
echo You may need to restart Windows Explorer for changes to take effect.

pause
endlocal 