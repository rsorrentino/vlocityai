/**
 * Country Flag Icons Utility
 * Provides SVG flag icons for countries
 */

import * as flags from 'country-flag-icons/react/3x2';

/**
 * Get flag component for a country code
 * @param {string} countryCode - 2-letter ISO country code
 * @returns {React.Component|null} Flag SVG component
 */
export const getCountryFlag = (countryCode) => {
  if (!countryCode) return null;
  
  // Convert to uppercase and handle special cases
  const code = countryCode.toUpperCase();
  
  // Map special codes
  const codeMap = {
    'UK': 'GB', // United Kingdom uses GB in ISO standards
  };
  
  const isoCode = codeMap[code] || code;
  
  // Get the flag component
  const FlagComponent = flags[isoCode];
  
  return FlagComponent || null;
};

/**
 * Get flag SVG as a data URL
 * @param {string} countryCode - 2-letter ISO country code
 * @returns {string|null} Data URL for flag SVG
 */
export const getCountryFlagSvg = (countryCode) => {
  const FlagComponent = getCountryFlag(countryCode);
  return FlagComponent;
};

/**
 * Check if a country code has a flag available
 * @param {string} countryCode - 2-letter ISO country code
 * @returns {boolean} True if flag is available
 */
export const hasFlagIcon = (countryCode) => {
  if (!countryCode) return false;
  const code = countryCode.toUpperCase();
  const codeMap = { 'UK': 'GB' };
  const isoCode = codeMap[code] || code;
  return !!flags[isoCode];
};

/**
 * Render a flag icon with consistent styling
 * @param {string} countryCode - 2-letter ISO country code
 * @param {Object} props - Additional props (width, height, style, etc.)
 * @returns {React.Element|null} Rendered flag element
 */
export const FlagIcon = ({ countryCode, width = 24, height = 18, style = {}, ...props }) => {
  const FlagComponent = getCountryFlag(countryCode);
  
  if (!FlagComponent) {
    return <span style={{ fontSize: width, ...style }}>🌍</span>;
  }
  
  return (
    <FlagComponent
      width={width}
      height={height}
      style={{
        borderRadius: '2px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        ...style
      }}
      {...props}
    />
  );
};

const FlagIconUtils = { getCountryFlag, getCountryFlagSvg, hasFlagIcon, FlagIcon };
export default FlagIconUtils;






