import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Theme = 'dark' | 'light' | 'studio';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

const VALID: Theme[] = ['dark', 'light', 'studio'];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('radix_theme');
    return (saved && (VALID as string[]).includes(saved)) ? (saved as Theme) : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('radix_theme', theme);
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('theme-studio', theme === 'studio');
  }, [theme]);

  // Cycle: dark → light → studio → dark
  const toggleTheme = () => setThemeState(prev =>
    prev === 'dark' ? 'light' : prev === 'light' ? 'studio' : 'dark'
  );
  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
