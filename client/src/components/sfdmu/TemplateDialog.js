import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Checkbox, FormControlLabel, Typography, Box,
  Accordion, AccordionSummary, AccordionDetails, Chip,
  Divider, Stack,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';

// ── Template catalog ──────────────────────────────────────────────────────────
// Objects listed in dependency order within each group.
// Across groups: Product Catalog → Attributes → Picklists → Pricing →
//                Product Relations → Calculation Matrices → Rules → GT → Standard

export const OBJECT_TEMPLATES = [
  {
    group: 'Product Catalog',
    color: 'primary',
    objects: [
      { sObjectType: 'Product2',   operation: 'Upsert', externalId: 'ProductCode',
        query: 'SELECT Id, Name, ProductCode, IsActive, Type, Family, Description, StockKeepingUnit FROM Product2 WHERE IsActive = true' },
      { sObjectType: 'Pricebook2', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT Id, Name, Description, IsActive, IsStandard FROM Pricebook2' },
      { sObjectType: 'PricebookEntry', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT Id, Name, UnitPrice, IsActive, Product2Id, Pricebook2Id, CurrencyIsoCode FROM PricebookEntry' },
    ],
  },
  {
    group: 'Vlocity Attributes',
    color: 'secondary',
    objects: [
      { sObjectType: 'vlocity_cmt__AttributeCategory__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__AttributeCategory__c' },
      { sObjectType: 'vlocity_cmt__Attribute__c',         operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__Attribute__c' },
      { sObjectType: 'vlocity_cmt__AttributeAssignment__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__AttributeAssignment__c' },
    ],
  },
  {
    group: 'Vlocity Picklists',
    color: 'info',
    objects: [
      { sObjectType: 'vlocity_cmt__Picklist__c',      operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__Picklist__c' },
      { sObjectType: 'vlocity_cmt__PicklistValue__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__PicklistValue__c' },
    ],
  },
  {
    group: 'Pricing',
    color: 'success',
    objects: [
      { sObjectType: 'vlocity_cmt__PricingElement__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__PricingElement__c' },
      { sObjectType: 'vlocity_cmt__PriceListEntry__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__PriceListEntry__c' },
      { sObjectType: 'vlocity_cmt__EntityFilter__c',   operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__EntityFilter__c' },
    ],
  },
  {
    group: 'Product Relations',
    color: 'warning',
    objects: [
      { sObjectType: 'vlocity_cmt__ProductChildItem__c',          operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__ProductChildItem__c' },
      { sObjectType: 'vlocity_cmt__CatalogProductRelationship__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CatalogProductRelationship__c' },
    ],
  },
  {
    group: 'Calculation Matrices',
    color: 'secondary',
    objects: [
      { sObjectType: 'vlocity_cmt__CalculationMatrix__c',        operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CalculationMatrix__c' },
      { sObjectType: 'vlocity_cmt__CalculationMatrixVersion__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CalculationMatrixVersion__c' },
      { sObjectType: 'vlocity_cmt__CalculationMatrixRow__c',     operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CalculationMatrixRow__c' },
    ],
  },
  {
    group: 'Calculation Procedures',
    color: 'secondary',
    objects: [
      { sObjectType: 'vlocity_cmt__CalculationProcedure__c',        operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CalculationProcedure__c' },
      { sObjectType: 'vlocity_cmt__CalculationProcedureVersion__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CalculationProcedureVersion__c' },
      { sObjectType: 'vlocity_cmt__CalculationProcedureStep__c',    operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__CalculationProcedureStep__c' },
    ],
  },
  {
    group: 'Rules & Filters',
    color: 'error',
    objects: [
      { sObjectType: 'vlocity_cmt__Rule__c',    operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__Rule__c' },
      { sObjectType: 'vlocity_cmt__Ruleset__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__Ruleset__c' },
    ],
  },
  {
    group: 'Object Layouts',
    color: 'primary',
    objects: [
      { sObjectType: 'vlocity_cmt__ObjectClass__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__ObjectClass__c' },
      { sObjectType: 'vlocity_cmt__ObjectLayout__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__ObjectLayout__c' },
      { sObjectType: 'vlocity_cmt__UISection__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__UISection__c' },
      { sObjectType: 'vlocity_cmt__UIFacet__c', operation: 'Upsert', externalId: 'Name',
        query: 'SELECT ALL FROM vlocity_cmt__UIFacet__c' },
    ],
  },
  {
    group: 'GT Custom Objects',
    color: 'info',
    objects: [
      { sObjectType: 'GT_ProductSKU__c',           operation: 'Upsert', externalId: 'GT_GlobalKey__c',
        query: 'SELECT ALL FROM GT_ProductSKU__c' },
{ sObjectType: 'GT_RateCode__c',             operation: 'Upsert', externalId: 'GT_GlobalKey__c',
        query: 'SELECT ALL FROM GT_RateCode__c' },
      { sObjectType: 'GT_RateTable__c',            operation: 'Upsert', externalId: 'GT_GlobalKey__c',
        query: 'SELECT ALL FROM GT_RateTable__c' },
    ],
  },
  {
    group: 'Standard Objects',
    color: 'default',
    objects: [
      { sObjectType: 'Campaign',  operation: 'Upsert', externalId: 'Name',
        query: 'SELECT Id, Name, Type, Status, StartDate, EndDate, IsActive, Description FROM Campaign' },
      { sObjectType: 'WorkType',  operation: 'Upsert', externalId: 'Name',
        query: 'SELECT Id, Name, Description, IsActive FROM WorkType' },
    ],
  },
];

// ── Helper: build initial checked state (all false) ───────────────────────────
function buildInitial() {
  const state = {};
  OBJECT_TEMPLATES.forEach(g => {
    g.objects.forEach(o => { state[o.sObjectType] = false; });
  });
  return state;
}

// ── Component ─────────────────────────────────────────────────────────────────
const TemplateDialog = ({ open, existingTypes = [], onApply, onClose }) => {
  const [checked, setChecked] = useState(buildInitial);

  const reset = () => setChecked(buildInitial());

  const toggleObject = (type) =>
    setChecked(prev => ({ ...prev, [type]: !prev[type] }));

  const toggleGroup = (group) => {
    const types = group.objects.map(o => o.sObjectType);
    const allOn = types.every(t => checked[t]);
    setChecked(prev => {
      const next = { ...prev };
      types.forEach(t => { next[t] = !allOn; });
      return next;
    });
  };

  const selectAll = () =>
    setChecked(Object.fromEntries(OBJECT_TEMPLATES.flatMap(g => g.objects.map(o => [o.sObjectType, true]))));

  const clearAll = () => setChecked(buildInitial());

  const handleApply = () => {
    const selected = OBJECT_TEMPLATES.flatMap(g =>
      g.objects.filter(o => checked[o.sObjectType])
    );
    onApply(selected);
    reset();
  };

  const selectedCount = Object.values(checked).filter(Boolean).length;
  const newCount = OBJECT_TEMPLATES.flatMap(g => g.objects)
    .filter(o => checked[o.sObjectType] && !existingTypes.includes(o.sObjectType)).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { maxHeight: '85vh' } }}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Load Object Templates</Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={selectAll}>All</Button>
            <Button size="small" onClick={clearAll}>None</Button>
          </Stack>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Select objects to add. Already-present objects will be skipped.
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 1 }}>
        {OBJECT_TEMPLATES.map((group) => {
          const groupTypes = group.objects.map(o => o.sObjectType);
          const allChecked = groupTypes.every(t => checked[t]);
          const someChecked = groupTypes.some(t => checked[t]) && !allChecked;

          return (
            <Accordion key={group.group} disableGutters elevation={0}
              sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', mb: 0.5 }}>
              <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 44, py: 0 }}>
                <FormControlLabel
                  onClick={e => e.stopPropagation()}
                  control={
                    <Checkbox
                      size="small"
                      checked={allChecked}
                      indeterminate={someChecked}
                      onChange={() => toggleGroup(group)}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={600}>{group.group}</Typography>
                      <Chip label={group.objects.length} size="small" color={group.color} />
                    </Box>
                  }
                />
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                <Divider sx={{ mb: 1 }} />
                {group.objects.map(obj => {
                  const alreadyExists = existingTypes.includes(obj.sObjectType);
                  return (
                    <Box key={obj.sObjectType} sx={{ display: 'flex', alignItems: 'center', pl: 1, mb: 0.5 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={checked[obj.sObjectType]}
                            onChange={() => toggleObject(obj.sObjectType)}
                          />
                        }
                        label={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                              {obj.sObjectType}
                            </Typography>
                            {alreadyExists && (
                              <Chip label="already added" size="small" variant="outlined" color="warning" />
                            )}
                            <Chip label={obj.externalId} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                          </Box>
                        }
                      />
                    </Box>
                  );
                })}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {selectedCount > 0
            ? `${selectedCount} selected — ${newCount} new, ${selectedCount - newCount} already present`
            : 'No objects selected'}
        </Typography>
        <Box>
          <Button onClick={() => { reset(); onClose(); }} sx={{ mr: 1 }}>Cancel</Button>
          <Button variant="contained" onClick={handleApply} disabled={selectedCount === 0}>
            Add {newCount > 0 ? `${newCount} Object${newCount !== 1 ? 's' : ''}` : ''}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default TemplateDialog;
