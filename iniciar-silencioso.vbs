' Reloj Subaton - inicia el reloj sin mostrar ninguna ventana (ni siquiera minimizada).
' Si este archivo no funciona en tu Windows, usa iniciar.bat: hace lo mismo.
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node iniciar.js", 0, False
