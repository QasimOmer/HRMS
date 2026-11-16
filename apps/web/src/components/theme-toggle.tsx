'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme';
import { Button } from './ui/button';

/** Light / dark switch (same preference everywhere in the app). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
