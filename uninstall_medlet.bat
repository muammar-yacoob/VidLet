@echo off
setlocal enabledelayedexpansion

echo VidLet - Uninstallation

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo This script requires Administrator privileges.
    echo Please run this script as an Administrator.
    pause
    exit /b 1
)

:: Set paths
set "INSTALL_DIR=%ProgramFiles%\VidLet"

:: Remove registry entries
echo Removing registry entries...
reg delete "HKEY_CLASSES_ROOT\SystemFileAssociations\.mp4\Shell\CompressVideo" /f >nul 2>&1
reg delete "HKEY_CLASSES_ROOT\SystemFileAssociations\.mkv\Shell\ConvertToMP4" /f >nul 2>&1

:: Remove installation directory
echo Removing installation directory...
if exist "%INSTALL_DIR%" rd /s /q "%INSTALL_DIR%"

echo.
echo VidLet has been successfully uninstalled!
echo You may need to restart Windows Explorer for changes to take effect.
pause
endlocal 