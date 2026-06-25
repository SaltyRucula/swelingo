import React from 'react';
import { Image, StyleSheet } from 'react-native';

interface Props {
  uri: string;
  size?: number;
}

export default function AvatarImage({ uri, size = 28 }: Props) {
  return (
    <Image
      source={{ uri }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
  },
});
