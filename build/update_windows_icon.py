import os
import shutil
import subprocess
import time

def main():
    print("Updating installed Windows app & Start Menu icon...")

    # 1. Target paths
    dist_unpacked = r"D:\Drift\dist\win-unpacked"
    local_app_dir = os.path.join(os.environ.get('LOCALAPPDATA', ''), r'Programs\Drift')
    start_menu_lnk = os.path.join(os.environ.get('APPDATA', ''), r'Microsoft\Windows\Start Menu\Programs\Drift.lnk')
    icon_ico_path = r"D:\Drift\build\icon.ico"

    print("Dist unpacked:", dist_unpacked)
    print("Installed path:", local_app_dir)
    print("Shortcut path:", start_menu_lnk)

    # 2. Copy dist\win-unpacked into LocalAppData Programs\Drift
    if os.path.exists(dist_unpacked):
        os.makedirs(local_app_dir, exist_ok=True)
        for item in os.listdir(dist_unpacked):
            s = os.path.join(dist_unpacked, item)
            d = os.path.join(local_app_dir, item)
            try:
                if os.path.isdir(s):
                    if os.path.exists(d):
                        shutil.rmtree(d, ignore_errors=True)
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)
            except Exception as e:
                print(f"Copy note for {item}: {e}")
        print("Updated installed application in LocalAppData Programs!")

    # 3. Create / update Start Menu shortcut using PowerShell WScript.Shell
    target_exe = os.path.join(local_app_dir, "Drift.exe")
    if not os.path.exists(target_exe):
        target_exe = r"D:\Drift\dist\win-unpacked\Drift.exe"

    ps_script = f"""
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut('{start_menu_lnk}')
$s.TargetPath = '{target_exe}'
$s.IconLocation = '{icon_ico_path},0'
$s.WorkingDirectory = '{local_app_dir}'
$s.Save()
"""
    ps_file = os.path.join(r"D:\Drift\build", "update_lnk.ps1")
    with open(ps_file, "w") as f:
        f.write(ps_script)

    subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", ps_file], check=True)
    print("Successfully updated Start Menu shortcut icon target!")

    # 4. Touch shortcut mtime & notify shell
    os.utime(start_menu_lnk, None)

    # Refresh Windows Shell Icon Cache
    try:
        subprocess.run(["ie4uinit.exe", "-show"], check=False)
        subprocess.run(["ie4uinit.exe", "-ClearIconCache"], check=False)
    except Exception as e:
        print("Shell refresh note:", e)

    print("Windows Search & Start Menu icon update complete!")

if __name__ == "__main__":
    main()
