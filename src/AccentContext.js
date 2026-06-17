import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from './theme';

const ACCENT_KEY = 'app_accent_color';

export const ACCENT_PRESETS = [
  { label: 'זהב', value: '#E8C547' },
  { label: 'תכלת', value: '#38BDF8' },
  { label: 'ירוק', value: '#4ADE80' },
  { label: 'סגול', value: '#A78BFA' },
  { label: 'כתום', value: '#FB923C' },
  { label: 'ורוד', value: '#F472B6' },
  { label: 'אדום', value: '#F87171' },
  { label: 'לבן', value: '#E2E8F0' },
];

const AccentContext = createContext({ accent: colors.accent, setAccent: () => {} });

export function AccentProvider({ children }) {
  const [accent, setAccentState] = useState(colors.accent);

  useEffect(() => {
    AsyncStorage.getItem(ACCENT_KEY).then((v) => {
      if (v) setAccentState(v);
    });
  }, []);

  const setAccent = async (color) => {
    setAccentState(color);
    await AsyncStorage.setItem(ACCENT_KEY, color);
  };

  return (
    <AccentContext.Provider value={{ accent, setAccent }}>
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent() {
  return useContext(AccentContext);
}
