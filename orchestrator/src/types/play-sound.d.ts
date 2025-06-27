declare module 'play-sound' {
  interface PlayerOptions {
    players?: string[];
    player?: string;
    opts?: string[]; // Player-specific command-line options
  }

  interface Player {
    play(input: Buffer | string, callback?: (err: unknown) => void): void;
  }

  function player(options?: PlayerOptions): Player;
  export default player;
} 