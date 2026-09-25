#!/usr/bin/env python3
"""Validate the ODM legacy equipment taxonomy DESIGN artifact.

The artifact is ODM-authored and ISO 14224-informed; it is NOT an ISO 14224
extract and carries no ISO conformance claim. The path is resolved relative to
this script so validation always targets the same file, regardless of the
caller's working directory.
"""
import json
import os

ARTIFACT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'odm_legacy_equipment_taxonomy_design.v1.json',
)

with open(ARTIFACT_PATH, 'r') as f:
    data = json.load(f)

print('=== ODM LEGACY EQUIPMENT TAXONOMY DESIGN VALIDATION ===')
print()
print('RECORD COUNTS:')
print(f'  Equipment Categories: {len(data["equipment_categories"])}')
print(f'  Equipment Classes: {len(data["equipment_classes"])}')
print(f'  Equipment Types: {len(data["equipment_types"])}')
print(f'  Subunits: {len(data["subunits"])}')
print(f'  Maintainable Items: {len(data["maintainable_items"])}')
print()
print('REQUIRED SECTIONS CHECK:')
required_keys = ['equipment_categories', 'equipment_classes', 'equipment_types', 
                 'subunits', 'maintainable_items', 'naming_conventions',
                 'future_addition_rules', 'template_link_rule', 'inspection_level_rule',
                 'consistency_rules', 'odm_taxonomy_summary']
for key in required_keys:
    status = 'OK' if key in data else 'MISSING'
    print(f'  {key}: {status}')
print()
print('FOREIGN KEY VALIDATION:')
# Check class -> category
class_cat_ids = set(c['equipment_category_id'] for c in data['equipment_classes'])
cat_ids = set(c['id'] for c in data['equipment_categories'])
print(f'  Classes -> Categories: {len(class_cat_ids - cat_ids)} orphans')

# Check type -> class
type_class_ids = set(t['equipment_class_id'] for t in data['equipment_types'])
class_ids = set(c['id'] for c in data['equipment_classes'])
print(f'  Types -> Classes: {len(type_class_ids - class_ids)} orphans')

# Check subunit -> type
sub_type_ids = set(s['equipment_type_id'] for s in data['subunits'])
type_ids = set(t['id'] for t in data['equipment_types'])
print(f'  Subunits -> Types: {len(sub_type_ids - type_ids)} orphans')

# Check MI -> type
mi_type_ids = set(m['equipment_type_id'] for m in data['maintainable_items'])
print(f'  Maintainable Items -> Types: {len(mi_type_ids - type_ids)} orphans')

# Check MI -> subunit
mi_sub_ids = set(m['subunit_id'] for m in data['maintainable_items'])
sub_ids = set(s['id'] for s in data['subunits'])
print(f'  Maintainable Items -> Subunits: {len(mi_sub_ids - sub_ids)} orphans')

print()
print('CODE UNIQUENESS CHECK:')
cat_codes = [c['code'] for c in data['equipment_categories']]
class_codes = [c['code'] for c in data['equipment_classes']]
type_codes = [t['code'] for t in data['equipment_types']]
sub_codes = [s['code'] for s in data['subunits']]

print(f'  Equipment Category codes unique: {len(cat_codes) == len(set(cat_codes))}')
print(f'  Equipment Class codes unique: {len(class_codes) == len(set(class_codes))}')
print(f'  Equipment Type codes unique: {len(type_codes) == len(set(type_codes))}')
print(f'  Subunit codes unique: {len(sub_codes) == len(set(sub_codes))}')

# Check template_anchor on equipment_types
print()
print('TEMPLATE ANCHOR CHECK:')
template_anchors = sum(1 for t in data['equipment_types'] if t.get('template_anchor'))
print(f'  Equipment types with template_anchor=true: {template_anchors}/{len(data["equipment_types"])}')

print()
print('ODM TAXONOMY SUMMARY:')
for key, value in data['odm_taxonomy_summary'].items():
    print(f'  {key}: {value}')

print()
print('SAMPLE EQUIPMENT TYPE WITH SUBUNITS:')
pump_type = [t for t in data['equipment_types'] if t['code'] == 'CENTRIFUGAL_PUMP'][0]
pump_subs = [s for s in data['subunits'] if s['equipment_type_id'] == pump_type['id']]
print(f'  {pump_type["name"]} ({pump_type["id"]})')
for sub in pump_subs:
    print(f'    - {sub["name"]} ({sub["code"]})')

print()
print('JSON OUTPUT: VALID')
print(f'File size: {len(json.dumps(data)) / 1024:.1f} KB')
