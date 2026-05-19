import React, { useState, useEffect } from 'react';
import { Fab } from '@mui/material';
import { KeyboardArrowUp } from '@mui/icons-material';

/**
 * Reusable ScrollToTop component
 * Shows a floating action button that appears after scrolling down
 * and smoothly scrolls back to the top when clicked
 */
const ScrollToTop = ({ showAfter = 400 }) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > showAfter) {
        setShow(true);
      } else {
        setShow(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [showAfter]);

  const handleClick = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  if (!show) return null;

  return (
    <Fab
      color="primary"
      size="small"
      aria-label="scroll back to top"
      onClick={handleClick}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 1000,
      }}
    >
      <KeyboardArrowUp />
    </Fab>
  );
};

export default ScrollToTop;

