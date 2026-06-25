import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCENT_KEY = 'doch1_accent_color';

export const ACCENT_PRESETS = [
  { color: '#E8C547', text: '#1A1A1A' },
  { color: '#4A9EFF', text: '#1A1A1A' },
  { color: '#4CAF50', text: '#1A1A1A' },
  { color: '#FF8C00', text: '#1A1A1A' },
  { color: '#E5484D', text: '#F2F2F2' },
  { color: '#B96EED', text: '#F2F2F2' },
];

const ThemeContext = createContext({
  accentColor: '#E8C547',
  accentTextColor: '#1A1A1A',
  setAccent: async () => {},
});

export function ThemeProvider({ children }) {
  const [accent, setAccentState] = useState(ACCENT_PRESETS[0]);

  useEffect(() => {
    AsyncStorage.getItem(ACCENT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.color && parsed?.text) setAccentState(parsed);
      } catch (_) {}
    });
  }, []);

  const setAccent = async (preset) => {
    setAccentState(preset);
    await AsyncStorage.setItem(ACCENT_KEY, JSON.stringify(preset));
  };

  return (
    <ThemeContext.Provider value={{ accentColor: accent.color, accentTextColor: accent.text, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
