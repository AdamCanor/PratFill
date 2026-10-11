import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { colors } from '../theme';

const ROW_HEIGHT = 28;
const SHOW_DELAY_MS = 3000;
const SLIDE_MS = 400;

// Vertical ticker of the launch recovery steps: the current step sits in the
// middle row in the accent color, the previous one above it and the next one
// below it, both grayed out. Advancing slides the whole column up one row.
// Hidden for the first SHOW_DELAY_MS so a normal fast launch never shows it —
// it only surfaces on the long loads it exists to explain.
//
// steps: [{ id, label }] in order; currentId: the running step's id. Steps
// may be dropped from the list mid-flight (a skipped step) — the rows simply
// re-index and the column slides to the new current position.
export default function LaunchSteps({ steps, currentId, accentColor }) {
  const index = Math.max(0, steps.findIndex((s) => s.id === currentId));
  // Color interpolation isn't supported by the native driver, so every
  // animation on this value (and the shared reveal) stays on the JS driver.
  const progress = useRef(new Animated.Value(index)).current;
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(reveal, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: index,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [index, progress]);

  const translateY = Animated.multiply(progress, -ROW_HEIGHT);

  return (
    <Animated.View style={[styles.window, { opacity: reveal }]} accessibilityLiveRegion="polite">
      <Animated.View style={{ paddingTop: ROW_HEIGHT, transform: [{ translateY }] }}>
        {steps.map((step, i) => (
          <Animated.Text
            key={step.id}
            numberOfLines={1}
            style={[
              styles.row,
              {
                color: progress.interpolate({
                  inputRange: [i - 1, i, i + 1],
                  outputRange: [colors.textMuted, accentColor, colors.textMuted],
                  extrapolate: 'clamp',
                }),
                opacity: progress.interpolate({
                  inputRange: [i - 2, i - 1, i, i + 1, i + 2],
                  outputRange: [0, 0.6, 1, 0.6, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            {step.label}
          </Animated.Text>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: {
    height: ROW_HEIGHT * 3,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  row: {
    height: ROW_HEIGHT,
    lineHeight: ROW_HEIGHT,
    fontSize: 14,
    textAlign: 'center',
  },
});
