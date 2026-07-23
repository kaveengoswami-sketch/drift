import os

localappdata = os.environ.get('LOCALAPPDATA', '')
programs = os.path.join(localappdata, 'Programs')

print('Programs path:', programs)
if os.path.exists(programs):
    for f in os.listdir(programs):
        if 'drift' in f.lower():
            full = os.path.join(programs, f)
            print('Found installed Drift dir:', full)
            if os.path.isdir(full):
                print('Contents:', os.listdir(full))
