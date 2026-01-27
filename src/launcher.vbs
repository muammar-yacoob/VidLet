' VidLet Launcher - Runs vidlet CLI from Windows with hidden console
' Usage: wscript launcher.vbs <command> <file> [options]

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set args = WScript.Arguments

If args.Count < 2 Then
    WScript.Quit 1
End If

command = args(0)
filePath = args(1)

' Get temp directory and clean up stale signal files BEFORE opening HTA
tempDir = WshShell.ExpandEnvironmentStrings("%TEMP%")
readyFile = tempDir & "\vidlet-ready.tmp"
progressFile = tempDir & "\vidlet-progress.tmp"
On Error Resume Next
If fso.FileExists(readyFile) Then fso.DeleteFile readyFile, True
If fso.FileExists(progressFile) Then fso.DeleteFile progressFile, True
On Error GoTo 0

' Get script directory
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
loadingHta = scriptDir & "\gui\loading.hta"

' Show loading window
If fso.FileExists(loadingHta) Then
    WshShell.Run "mshta """ & loadingHta & """", 1, False
End If

' Convert Windows path to WSL path
If Mid(filePath, 2, 1) = ":" Then
    driveLetter = LCase(Left(filePath, 1))
    restOfPath = Mid(filePath, 3)
    restOfPath = Replace(restOfPath, "\", "/")
    wslPath = "/mnt/" & driveLetter & restOfPath
Else
    wslPath = Replace(filePath, "\", "/")
End If

' Build flags from remaining arguments
flags = ""
For i = 2 To args.Count - 1
    flags = flags & " " & args(i)
Next

' Run wsl command (hidden, don't wait)
cmd = "wsl vidlet " & command & " """ & wslPath & """" & flags
WshShell.Run cmd, 0, False
