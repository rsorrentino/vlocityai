import React, { useState } from 'react';
import {
  Box,
  TextField,
  Autocomplete,
  Chip,
  Button,
  IconButton,
  Paper,
} from '@mui/material';
import {
  Search,
  Clear,
  FilterList,
} from '@mui/icons-material';

/**
 * Advanced Search Component
 * Provides unified search and filtering across all modules
 */
function AdvancedSearch({
  onSearch,
  onFilterChange,
  filters = [],
  placeholder = 'Search...',
  searchValue = '',
  onSearchChange,
}) {
  const [localSearchValue, setLocalSearchValue] = useState(searchValue);
  const [activeFilters, setActiveFilters] = useState({});

  const handleSearch = (value) => {
    setLocalSearchValue(value);
    if (onSearchChange) {
      onSearchChange(value);
    }
    if (onSearch) {
      onSearch(value);
    }
  };

  const handleFilterToggle = (filterKey, filterValue) => {
    const newFilters = { ...activeFilters };
    if (newFilters[filterKey] === filterValue) {
      delete newFilters[filterKey];
    } else {
      newFilters[filterKey] = filterValue;
    }
    setActiveFilters(newFilters);
    if (onFilterChange) {
      onFilterChange(newFilters);
    }
  };

  const clearFilters = () => {
    setActiveFilters({});
    setLocalSearchValue('');
    if (onFilterChange) {
      onFilterChange({});
    }
    if (onSearchChange) {
      onSearchChange('');
    }
  };

  const hasActiveFilters = Object.keys(activeFilters).length > 0 || localSearchValue;

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1, minWidth: 200 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={placeholder}
            value={localSearchValue}
            onChange={(e) => handleSearch(e.target.value)}
            InputProps={{
              startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
              endAdornment: localSearchValue && (
                <IconButton
                  size="small"
                  onClick={() => handleSearch('')}
                >
                  <Clear fontSize="small" />
                </IconButton>
              ),
            }}
          />
        </Box>

        {filters.map((filter) => (
          <Autocomplete
            key={filter.key}
            size="small"
            options={filter.options || []}
            value={activeFilters[filter.key] || null}
            onChange={(e, value) => handleFilterToggle(filter.key, value)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={filter.label}
                placeholder={filter.placeholder}
              />
            )}
            sx={{ minWidth: 150 }}
          />
        ))}

        {hasActiveFilters && (
          <Button
            size="small"
            startIcon={<Clear />}
            onClick={clearFilters}
            variant="outlined"
          >
            Clear
          </Button>
        )}
      </Box>

      {hasActiveFilters && (
        <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterList fontSize="small" color="action" />
          {localSearchValue && (
            <Chip
              label={`Search: "${localSearchValue}"`}
              size="small"
              onDelete={() => handleSearch('')}
            />
          )}
          {Object.entries(activeFilters).map(([key, value]) => {
            const filter = filters.find(f => f.key === key);
            return (
              <Chip
                key={key}
                label={`${filter?.label || key}: ${value}`}
                size="small"
                onDelete={() => handleFilterToggle(key, value)}
              />
            );
          })}
        </Box>
      )}
    </Paper>
  );
}

export default AdvancedSearch;

