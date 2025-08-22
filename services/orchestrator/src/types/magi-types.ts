export const MagiName = {
  Balthazar: 'Balthazar',
  Melchior: 'Melchior',
  Caspar: 'Caspar',
} as const;

export type MagiName = typeof MagiName[keyof typeof MagiName];

export const MessageParticipant = {
  ...MagiName,
  User: 'User',
  System: 'System',
  Magi: 'Magi',
} as const;

export type MessageParticipant = typeof MessageParticipant[keyof typeof MessageParticipant];
