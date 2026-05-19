#!/usr/bin/env python3
"""
Script to fix various DataPack errors:
1. JSON parsing errors (trailing garbage after closing brace)
2. Find and report duplicate ProductChildItem records
3. Find and report missing parent/child product references
"""

import json
import os
from pathlib import Path
from collections import defaultdict

def fix_json_parsing_errors(root_dir):
    """Fix JSON files with trailing garbage after closing brace"""
    fixed = []
    root = Path(root_dir)
    
    for json_file in root.rglob('*_DataPack.json'):
        try:
            text = json_file.read_text(encoding='utf-8', errors='ignore')
            stripped = text.rstrip()
            
            # If it already ends with }, it's probably fine
            if stripped.endswith('}'):
                # Try to parse it
                try:
                    json.loads(stripped)
                    continue
                except json.JSONDecodeError:
                    pass
            
            # Find the last valid closing brace
            last_brace = stripped.rfind('}')
            if last_brace == -1:
                print(f"  Skipping {json_file}: No closing brace found")
                continue
            
            # Extract valid JSON
            valid_json = stripped[:last_brace + 1]
            
            # Validate it
            try:
                json.loads(valid_json)
                # Write back with newline
                json_file.write_text(valid_json + '\n', encoding='utf-8')
                fixed.append(str(json_file))
            except json.JSONDecodeError as e:
                print(f"  Warning: Could not fix {json_file}: {e}")
                
        except Exception as e:
            print(f"  Error processing {json_file}: {e}")
    
    return fixed

def find_duplicate_product_child_items(root_dir):
    """Find ProductChildItem records with duplicate parent+child combinations"""
    root = Path(root_dir)
    duplicates = defaultdict(list)
    
    for json_file in root.rglob('*ProductChildItem*/*_DataPack.json'):
        try:
            text = json_file.read_text(encoding='utf-8', errors='ignore')
            stripped = text.rstrip()
            
            # Clean trailing garbage
            last_brace = stripped.rfind('}')
            if last_brace == -1:
                continue
            valid_json = stripped[:last_brace + 1]
            
            data = json.loads(valid_json)
            
            # Get parent and child product IDs
            parent_id = data.get('%vlocity_namespace%__ParentProductId__c', {})
            child_id = data.get('%vlocity_namespace%__ChildProductId__c', {})
            
            parent_key = parent_id.get('%vlocity_namespace%__GlobalKey__c') if isinstance(parent_id, dict) else None
            child_key = child_id.get('%vlocity_namespace%__GlobalKey__c') if isinstance(child_id, dict) else None
            
            if parent_key and child_key:
                key = (parent_key, child_key)
                duplicates[key].append({
                    'file': str(json_file),
                    'name': data.get('Name', 'Unknown'),
                    'seq': data.get('%vlocity_namespace%__SeqNumber__c', 0)
                })
        except Exception as e:
            pass
    
    # Filter to only actual duplicates (more than one record)
    actual_duplicates = {k: v for k, v in duplicates.items() if len(v) > 1}
    return actual_duplicates

def find_missing_references(root_dir):
    """Find ProductChildItem records with missing parent or child product references"""
    root = Path(root_dir)
    missing_refs = []
    
    # First, collect all available Product2 GlobalKeys
    available_products = set()
    product_dir = root.parent / 'Product2'
    if product_dir.exists():
        for json_file in product_dir.rglob('*_DataPack.json'):
            try:
                text = json_file.read_text(encoding='utf-8', errors='ignore')
                stripped = text.rstrip()
                last_brace = stripped.rfind('}')
                if last_brace == -1:
                    continue
                valid_json = stripped[:last_brace + 1]
                data = json.loads(valid_json)
                global_key = data.get('%vlocity_namespace%__GlobalKey__c')
                if global_key:
                    available_products.add(global_key)
            except:
                pass
    
    # Now check ProductChildItem records
    for json_file in root.rglob('*ProductChildItem*/*_DataPack.json'):
        try:
            text = json_file.read_text(encoding='utf-8', errors='ignore')
            stripped = text.rstrip()
            last_brace = stripped.rfind('}')
            if last_brace == -1:
                continue
            valid_json = stripped[:last_brace + 1]
            data = json.loads(valid_json)
            
            parent_id = data.get('%vlocity_namespace%__ParentProductId__c', {})
            child_id = data.get('%vlocity_namespace%__ChildProductId__c', {})
            
            parent_key = parent_id.get('%vlocity_namespace%__GlobalKey__c') if isinstance(parent_id, dict) else None
            child_key = child_id.get('%vlocity_namespace%__GlobalKey__c') if isinstance(child_id, dict) else None
            
            issues = []
            if parent_key and parent_key not in available_products:
                issues.append(f"Missing parent: {parent_key}")
            if child_key and child_key not in available_products:
                issues.append(f"Missing child: {child_key}")
            if not parent_key:
                issues.append("Null parent GlobalKey")
            if not child_key:
                issues.append("Null child GlobalKey")
            
            if issues:
                missing_refs.append({
                    'file': str(json_file),
                    'name': data.get('Name', 'Unknown'),
                    'issues': issues
                })
        except:
            pass
    
    return missing_refs

if __name__ == '__main__':
    root_dir = 'export/uat-delta'
    
    print("=" * 80)
    print("Fixing JSON parsing errors...")
    print("=" * 80)
    fixed = fix_json_parsing_errors(root_dir)
    print(f"Fixed {len(fixed)} JSON files with parsing errors")
    if fixed:
        print("\nFirst 10 fixed files:")
        for f in fixed[:10]:
            print(f"  - {f}")
        if len(fixed) > 10:
            print(f"  ... and {len(fixed) - 10} more")
    
    print("\n" + "=" * 80)
    print("Finding duplicate ProductChildItem records...")
    print("=" * 80)
    duplicates = find_duplicate_product_child_items(Path(root_dir) / 'SObject_ProductChildItem')
    print(f"Found {len(duplicates)} duplicate parent+child combinations")
    
    if duplicates:
        print("\nDuplicate records (keeping the one with lowest SeqNumber):")
        for (parent_key, child_key), records in list(duplicates.items())[:20]:
            print(f"\n  Parent: {parent_key[:20]}..., Child: {child_key[:20]}...")
            # Sort by sequence number and keep the first one
            records.sort(key=lambda x: x['seq'])
            keep = records[0]
            remove = records[1:]
            print(f"    KEEP: {keep['name']} (Seq: {keep['seq']})")
            for r in remove:
                print(f"    REMOVE: {r['name']} (Seq: {r['seq']}) - {r['file']}")
    
    print("\n" + "=" * 80)
    print("Finding missing product references...")
    print("=" * 80)
    missing = find_missing_references(Path(root_dir) / 'SObject_ProductChildItem')
    print(f"Found {len(missing)} ProductChildItem records with missing references")
    
    if missing:
        print("\nFirst 20 records with missing references:")
        for m in missing[:20]:
            print(f"\n  {m['name']}:")
            for issue in m['issues']:
                print(f"    - {issue}")
            print(f"    File: {m['file']}")
    
    print("\n" + "=" * 80)
    print("Summary:")
    print(f"  - Fixed {len(fixed)} JSON parsing errors")
    print(f"  - Found {len(duplicates)} duplicate ProductChildItem combinations")
    print(f"  - Found {len(missing)} records with missing product references")
    print("=" * 80)


