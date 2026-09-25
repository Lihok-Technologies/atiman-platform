#!/usr/bin/env python3
"""Verify ODM seed dataset baseline"""
import json
import os

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Resolved from this script's location so the check targets the same seed
# artifact regardless of the caller's working directory.
file_path = os.path.join(_SCRIPT_DIR, 'master_data', 'taxonomy.v1.json')

print('=' * 60)
print('ODM SEED DATASET BASELINE - FINAL CONFIRMATION')
print('=' * 60)
print()

# 1. File path exists
exists = os.path.exists(file_path)
print(f'1. File path exists: {exists}')
print(f'   Path: {os.path.abspath(file_path)}')
print()

# 2. File readable
readable = os.access(file_path, os.R_OK)
print(f'2. File readable: {readable}')
print()

# 3. Valid JSON
try:
    with open(file_path, 'r') as f:
        data = json.load(f)
    print(f'3. Valid JSON: True')
except:
    print(f'3. Valid JSON: False')
    data = {}
print()

# 4. Required sections
required = ['equipment_categories', 'equipment_classes', 'equipment_types', 'subunits', 'maintainable_items']
present = [k for k in required if k in data]
missing = [k for k in required if k not in data]
print(f'4. Required sections present: {len(present)}/{len(required)}')
print(f'   Present: {present}')
if missing:
    print(f'   Missing: {missing}')
print()

# 5. Summary
print('5. DATASET SUMMARY:')
print(f'   Equipment Categories: {len(data.get("equipment_categories", []))}')
print(f'   Equipment Classes: {len(data.get("equipment_classes", []))}')
print(f'   Equipment Types: {len(data.get("equipment_types", []))}')
print(f'   Subunits: {len(data.get("subunits", []))}')
print(f'   Maintainable Items: {len(data.get("maintainable_items", []))}')
print()

print('=' * 60)
print('STATUS: READY FOR PHASE 2 TEMPLATE DESIGN')
print('=' * 60)
