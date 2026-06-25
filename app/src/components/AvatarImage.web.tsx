import React from 'react';

interface Props {
  uri: string;
  size?: number;
}

export default function AvatarImage({ uri, size = 28 }: Props) {
  return (
    <img
      src={uri}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        objectFit: 'cover',
        backgroundColor: '#E0E0E0',
        display: 'block',
      }}
      alt=""
    />
  );
}
