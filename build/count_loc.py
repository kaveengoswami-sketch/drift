import os

ROOT = r"D:\Drift"
EXCLUDE_DIRS = {'.git', 'node_modules', 'dist', 'out', '.claude', 'preview_icons'}

stats_by_ext = {}
stats_by_dir = {}
total_lines = 0
total_files = 0

for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
    for file in files:
        ext = os.path.splitext(file)[1].lower()
        if not ext:
            ext = os.path.basename(file)
        
        filepath = os.path.join(root, file)
        relpath = os.path.relpath(filepath, ROOT)
        top_dir = relpath.split(os.sep)[0]

        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                lines = sum(1 for _ in f)
        except Exception:
            continue

        total_lines += lines
        total_files += 1

        stats_by_ext[ext] = stats_by_ext.get(ext, 0) + lines
        stats_by_dir[top_dir] = stats_by_dir.get(top_dir, 0) + lines

print("=== LINES OF CODE SUMMARY FOR DRIFT ===")
print(f"Total Source Lines of Code: {total_lines:,} across {total_files} files\n")

print("--- Breakdown by Folder ---")
for d, count in sorted(stats_by_dir.items(), key=lambda x: x[1], reverse=True):
    print(f"  {d:<20}: {count:>6,} lines")

print("\n--- Breakdown by Extension ---")
for ext, count in sorted(stats_by_ext.items(), key=lambda x: x[1], reverse=True):
    print(f"  {ext:<20}: {count:>6,} lines")
