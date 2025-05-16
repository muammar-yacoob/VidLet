@echo off
setlocal enabledelayedexpansion
color 0C

echo ================================
echo   VidLet - Uninstallation
echo ================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Administrator privileges required!
    pause
    exit /b 1
)

:: Set paths
set "INSTALL_DIR=%ProgramFiles%\VidLet"

:: Remove registry entries
echo Removing registry entries...
reg delete "HKEY_CLASSES_ROOT\SystemFileAssociations\.mp4\Shell\CompressVideo" /f
reg delete "HKEY_CLASSES_ROOT\SystemFileAssociations\.mkv\Shell\ConvertToMP4" /f
reg delete "HKEY_CLASSES_ROOT\SystemFileAssociations\.mp4\Shell\ShrinkVideo" /f

:: Remove installation directory
echo Removing installation directory...
if exist "%INSTALL_DIR%" (
    :: Remove specific files first to ensure they're gone
    if exist "%INSTALL_DIR%\src\compress.bat" del /f /q "%INSTALL_DIR%\src\compress.bat"
    if exist "%INSTALL_DIR%\src\mkv2mp4.bat" del /f /q "%INSTALL_DIR%\src\mkv2mp4.bat"
    if exist "%INSTALL_DIR%\src\ShrinkVideo.bat" del /f /q "%INSTALL_DIR%\src\ShrinkVideo.bat"
    if exist "%INSTALL_DIR%\src\icons\*.ico" del /f /q "%INSTALL_DIR%\src\icons\*.ico"
    if exist "%INSTALL_DIR%\libs\ffmpeg.exe" del /f /q "%INSTALL_DIR%\libs\ffmpeg.exe"
    
    :: Then remove directories
    rd /s /q "%INSTALL_DIR%" 2>nul
)

echo.
echo Uninstallation complete!
echo.
echo VidLet has been successfully removed from your system.
echo You may need to restart Windows Explorer for changes to take effect.

pause
endlocal 