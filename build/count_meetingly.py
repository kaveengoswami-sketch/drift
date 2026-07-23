import os

ROOT = r"D:\Meetingly"
EXCLUDE_DIRS = {'.git', '.venv', '__pycache__'}

stats_by_ext = {}
total_lines = 0
total_files = 0
file_details = []

for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
    for file in files:
        ext = os.path.splitext(file)[1].lower()
        if not ext:
            ext = os.path.basename(file)
        
        filepath = os.path.join(root, file)
        relpath = os.path.relpath(filepath, ROOT)

        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                lines = sum(1 for _ in f)
        except Exception:
            continue

        total_lines += lines
        total_files += 1

        stats_by_ext[ext] = stats_by_ext.get(ext, 0) + lines
        file_details.append((relpath, lines))

file_details.sort(key=lambda x: x[1], reverse=True)

print("=== LINES OF CODE SUMMARY FOR MEETINGLY ===")
print(f"Total Source Lines of Code: {total_lines:,} across {total_files} files\n")

print("--- File-by-File Breakdown ---")
for relpath, count in file_details:
    print(f"  {relpath:<30}: {count:>6,} lines")

print("\n--- Breakdown by Extension ---")
for ext, count in sorted(stats_by_ext.items(), key=lambda x: x[1], reverse=True):
    print(f"  {ext:<20}: {count:>6,} lines")
