Option Explicit

Dim shell, fileSystem, scriptDirectory, powerShellScript
Dim nodePath, mode, command, exitCode

If WScript.Arguments.Count < 2 Then
  WScript.Quit 2
End If

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = fileSystem.BuildPath(scriptDirectory, "start-devhub.ps1")
nodePath = WScript.Arguments(0)
mode = WScript.Arguments(1)

command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass" _
  & " -File " & QuoteArgument(powerShellScript) _
  & " -NodePath " & QuoteArgument(nodePath) _
  & " -Mode " & QuoteArgument(mode)

' Window style 0 keeps PowerShell, Node and their console host completely hidden.
' The third argument waits so Task Scheduler can monitor the real DevHub lifetime.
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
