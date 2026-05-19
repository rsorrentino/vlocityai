/**
 * Strip Vlocity/GT technical prefixes and __c/__r suffixes, then convert
 * PascalCase/camelCase to a readable "Title Case With Spaces" label.
 *
 * Examples:
 *   "vlocity_cmt__GlobalKey__c"  → "Global Key"
 *   "GT_CountryCode__c"          → "Country Code"
 *   "IsActive"                   → "Is Active"
 *   "ProductCode"                → "Product Code"
 */
export function formatFieldLabel(apiName) {
  if (!apiName) return '';
  return apiName
    .replace(/^vlocity_cmt__/g, '')
    .replace(/^GT_/g, '')
    .replace(/__c$/g, '')
    .replace(/__r$/g, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase → spaced
    .replace(/\b\w/g, c => c.toUpperCase()) // Title Case
    .trim();
}

/**
 * Return a Salesforce record URL when the instance URL is known,
 * or null so callers can fall back to plain text.
 */
export function sfRecordUrl(instanceUrl, id) {
  if (!instanceUrl || !id) return null;
  return `${instanceUrl}/${id}`;
}
