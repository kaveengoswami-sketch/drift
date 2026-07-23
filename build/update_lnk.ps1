
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut('C:\Users\kavee\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Drift.lnk')
$s.TargetPath = 'C:\Users\kavee\AppData\Local\Programs\Drift\Drift.exe'
$s.IconLocation = 'D:\Drift\build\icon.ico,0'
$s.WorkingDirectory = 'C:\Users\kavee\AppData\Local\Programs\Drift'
$s.Save()
