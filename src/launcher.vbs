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

' For .json files, verify it's a Lottie animation before proceeding
If LCase(fso.GetExtensionName(filePath)) = "json" Then
    On Error Resume Next
    Set jsonFile = fso.OpenTextFile(filePath, 1, False)
    If Err.Number <> 0 Then
        WScript.Quit 1
    End If
    ' Read first 512 bytes to check for Lottie markers
    header = jsonFile.Read(512)
    jsonFile.Close
    On Error GoTo 0
    ' Lottie files contain "v" (version), "fr" (framerate), and "op"/"ip" (frames)
    isLottie = False
    If InStr(1, header, """v""", vbTextCompare) > 0 Then
        If InStr(1, header, """fr""", vbTextCompare) > 0 Or _
           InStr(1, header, """op""", vbTextCompare) > 0 Or _
           InStr(1, header, """ip""", vbTextCompare) > 0 Then
            isLottie = True
        End If
    End If
    If Not isLottie Then WScript.Quit 0
End If

' Get temp directory
tempDir = WshShell.ExpandEnvironmentStrings("%TEMP%")

' Get script directory
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Check for --no-loading flag
skipLoading = False
For i = 2 To args.Count - 1
    If args(i) = "--no-loading" Then skipLoading = True
Next

' Build flags from remaining arguments (skip internal flags)
flags = ""
For i = 2 To args.Count - 1
    If args(i) <> "--no-loading" Then flags = flags & " " & args(i)
Next

' --- Headless/batch mode (optimize): batch files, single toast, single run ---
If skipLoading Then
    Dim batchFile, lockFile
    batchFile = tempDir & "\vidlet-batch.tmp"
    lockFile = tempDir & "\vidlet-batch-lock.tmp"

    ' Append this file to the batch list
    Dim ts
    Set ts = fso.OpenTextFile(batchFile, 8, True)
    ts.WriteLine filePath
    ts.Close

    ' If lock file exists, another launcher is already waiting to run the batch
    If fso.FileExists(lockFile) Then
        WScript.Quit 0
    End If

    ' We are the first - create lock and wait for more files to arrive
    Set ts = fso.CreateTextFile(lockFile, True)
    ts.Close

    ' Wait briefly for Windows to finish invoking all selected files
    WScript.Sleep 800

    ' Read all batched files
    Dim allFiles, fileLines
    Set ts = fso.OpenTextFile(batchFile, 1)
    allFiles = ts.ReadAll()
    ts.Close

    ' Clean up batch/lock files
    On Error Resume Next
    fso.DeleteFile batchFile, True
    fso.DeleteFile lockFile, True
    On Error GoTo 0

    ' Clean stale signal files
    Dim doneFile, progressFile2
    doneFile = tempDir & "\vidlet-optimize-done.tmp"
    progressFile2 = tempDir & "\vidlet-optimize-progress.tmp"
    On Error Resume Next
    If fso.FileExists(doneFile) Then fso.DeleteFile doneFile, True
    If fso.FileExists(progressFile2) Then fso.DeleteFile progressFile2, True
    On Error GoTo 0

    ' Show toast HTA
    Dim toastHta
    toastHta = scriptDir & "\gui\optimize-toast.hta"
    If fso.FileExists(toastHta) Then
        WshShell.Run "mshta """ & toastHta & """", 1, False
    End If

    ' Convert each file to WSL path and run as single command
    fileLines = Split(allFiles, vbCrLf)
    Dim wslPaths, fp, wslP
    wslPaths = ""
    For Each fp In fileLines
        fp = Trim(fp)
        If fp <> "" Then
            If Mid(fp, 2, 1) = ":" Then
                wslP = "/mnt/" & LCase(Left(fp, 1)) & Replace(Mid(fp, 3), "\", "/")
            Else
                wslP = Replace(fp, "\", "/")
            End If
            wslPaths = wslPaths & " """ & wslP & """"
        End If
    Next

    Dim cmd
    cmd = "wsl vidlet " & command & wslPaths & flags
    WshShell.Run cmd, 0, False
    WScript.Quit 0
End If

' --- GUI mode (video tools): single file, loading HTA ---
Dim readyFile, progressFile
readyFile = tempDir & "\vidlet-ready.tmp"
progressFile = tempDir & "\vidlet-progress.tmp"
On Error Resume Next
If fso.FileExists(readyFile) Then fso.DeleteFile readyFile, True
If fso.FileExists(progressFile) Then fso.DeleteFile progressFile, True
On Error GoTo 0

Dim loadingHta
loadingHta = scriptDir & "\gui\loading.hta"
If fso.FileExists(loadingHta) Then
    WshShell.Run "mshta """ & loadingHta & """", 1, False
End If

' Convert Windows path to WSL path
Dim wslPath
If Mid(filePath, 2, 1) = ":" Then
    wslPath = "/mnt/" & LCase(Left(filePath, 1)) & Replace(Mid(filePath, 3), "\", "/")
Else
    wslPath = Replace(filePath, "\", "/")
End If

' Run wsl command (hidden, don't wait)
Dim guiCmd
guiCmd = "wsl vidlet " & command & " """ & wslPath & """" & flags
WshShell.Run guiCmd, 0, False
