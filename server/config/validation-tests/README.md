# Validation Test Definitions

This directory contains YAML-based validation test definitions for Salesforce objects.

## Structure

Each YAML file defines validation tests for a specific object type:

```yaml
ObjectType:
  tests:
    - name: TestName
      description: Test description
      query: SOQL query to retrieve records
      validation:
        required_fields: [...]
        check_duplicates: { field: ... }
        date_range: { ... }
        relationship_check: { ... }
      severity: error|warning
```

## Available Tests

### PriceList.yaml
- **RequiredFields** - Checks that Code and CurrencyCode are populated
- **DateRanges** - Validates effective date ranges
- **OrphanedEntries** - Checks for price list entries without parent price list

### RateCode.yaml
- **RequiredFields** - Checks OrgCode and VATCode
- **DateRanges** - Validates effective date ranges
- **MissingVATCode** - Checks for rate codes missing VAT codes

### RateTable.yaml
- **RequiredFields** - Checks OrgCode, RateCode, and Product
- **OrphanedTables** - Checks for orphaned rate tables
- **DateRanges** - Validates effective date ranges

### Promotion.yaml
- **RequiredFields** - Checks Code and Description
- **OrphanedPromotions** - Checks for promotions missing price list references

## Validation Rules

### Required Fields
```yaml
validation:
  required_fields:
    - Field1__c
    - Field2__c
```

### Duplicate Check
```yaml
validation:
  check_duplicates:
    field: Code__c
```

### Date Range
```yaml
validation:
  date_range:
    start_field: StartDate__c
    end_field: EndDate__c
    rule: end_after_start
```

### Relationship Check
```yaml
validation:
  relationship_check:
    field: ParentId__c
    parent_object: ParentObject__c
```

Or for multiple relationships:
```yaml
validation:
  relationship_check:
    fields:
      - field: Field1__c
        parent_object: Object1__c
      - field: Field2__c
        parent_object: Object2__c
```

## Usage

Tests are automatically loaded by `ValidationService` on startup. Use the API to run:

```bash
# Run all YAML tests
GET /api/validation/yaml-tests?username=user@example.com

# Run specific object types
GET /api/validation/yaml-tests?username=user@example.com&objectTypes=PriceList,RateCode

# Get available test definitions
GET /api/validation/test-definitions
```

## Adding New Tests

1. Create a new YAML file named after the object type (e.g., `Product.yaml`)
2. Define tests with queries and validation rules
3. Restart the server to load new definitions

Tests are automatically discovered and loaded at server startup.

