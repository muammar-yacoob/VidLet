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

' Check for --no-loading flag
skipLoading = False
For i = 2 To args.Count - 1
    If args(i) = "--no-loading" Then skipLoading = True
Next

' Show appropriate window
If skipLoading Then
    ' Show small toast notification for headless tools
    Dim toastHta
    toastHta = scriptDir & "\gui\optimize-toast.hta"
    ' Clean stale done signal
    Dim doneFile
    doneFile = tempDir & "\vidlet-optimize-done.tmp"
    On Error Resume Next
    If fso.FileExists(doneFile) Then fso.DeleteFile doneFile, True
    On Error GoTo 0
    If fso.FileExists(toastHta) Then
        WshShell.Run "mshta """ & toastHta & """", 1, False
    End If
ElseIf fso.FileExists(loadingHta) Then
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

' Build flags from remaining arguments (skip internal flags)
flags = ""
For i = 2 To args.Count - 1
    If args(i) <> "--no-loading" Then flags = flags & " " & args(i)
Next

' Run wsl command (hidden, don't wait)
cmd = "wsl vidlet " & command & " """ & wslPath & """" & flags
WshShell.Run cmd, 0, False
