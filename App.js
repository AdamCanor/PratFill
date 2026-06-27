import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { KeyboardProvider } from 'react-native-keyboard-controller';

export default function App() {
  return (
    <KeyboardProvider>
      <ThemeProvider>
        <RootNavigator />
        <StatusBar style="light" />
      </ThemeProvider>
    </KeyboardProvider>
  );
}
