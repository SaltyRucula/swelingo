import React from 'react';
import { TextInput, StyleSheet } from 'react-native';

interface Props {
  language: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// Maximum characters that can be added in a single change event.
// Typing or using autocomplete inserts at most a few characters at once;
// anything larger is almost certainly a paste and should be rejected.
const MAX_SINGLE_ADDITION = 10;

export default function CodeEditorWidget({ value, onChange, disabled }: Props) {
  const handleChangeText = (newText: string) => {
    const added = newText.length - value.length;
    if (added > MAX_SINGLE_ADDITION) {
      // Reject — the controlled value prop will revert the field
      return;
    }
    onChange(newText);
  };

  return (
    <TextInput
      style={[styles.editor, disabled && styles.disabled]}
      value={value}
      onChangeText={handleChangeText}
      editable={!disabled}
      multiline
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      // Hide long-press context menu (Cut / Copy / Paste) on iOS & Android
      contextMenuHidden
      placeholder="// Write your solution here…"
      placeholderTextColor="#5C6B7A"
    />
  );
}

const styles = StyleSheet.create({
  editor: {
    backgroundColor: '#1E2433',
    borderRadius: 10,
    padding: 14,
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#E8EAF0',
    lineHeight: 20,
    minHeight: 240,
    borderWidth: 2,
    borderColor: '#2D3561',
    textAlignVertical: 'top',
  },
  disabled: {
    opacity: 0.6,
  },
});
