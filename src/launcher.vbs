' VidLet Launcher - Runs vidlet CLI from Windows with hidden console
' Usage: wscript launcher.vbs <command> <file> [options]

Option Explicit

Dim WshShell, fso, args, command, filePath, wslPath, fullCmd, htaPath, htaProc

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get command line arguments
Set args = WScript.Arguments

If args.Count < 2 Then
    WScript.Echo "Usage: launcher.vbs <command> <file> [options]"
    WScript.Quit 1
End If

command = args(0)
filePath = args(1)

' Convert Windows path to WSL path
wslPath = ConvertToWSLPath(filePath)

' Show loading HTA
htaPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\gui\loading.hta"
If fso.FileExists(htaPath) Then
    Set htaProc = WshShell.Exec("mshta.exe """ & htaPath & """")
End If

' Build the WSL command
fullCmd = "wsl.exe -e bash -c ""vidlet " & command & " '" & wslPath & "' -g"""

' Run the command (hidden window)
WshShell.Run fullCmd, 0, False

' Cleanup
Set WshShell = Nothing
Set fso = Nothing

Function ConvertToWSLPath(winPath)
    Dim drive, rest

    ' Handle UNC paths
    If Left(winPath, 2) = "\\" Then
        ConvertToWSLPath = winPath
        Exit Function
    End If

    ' Handle drive letter paths (C:\path\to\file)
    If Mid(winPath, 2, 1) = ":" Then
        drive = LCase(Left(winPath, 1))
        rest = Mid(winPath, 4)
        rest = Replace(rest, "\", "/")
        ConvertToWSLPath = "/mnt/" & drive & "/" & rest
    Else
        ' Relative path - just convert backslashes
        ConvertToWSLPath = Replace(winPath, "\", "/")
    End If
End Function
