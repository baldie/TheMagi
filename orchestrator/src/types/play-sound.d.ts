declare module 'play-sound' {
  interface PlayerOptions {
    players?: string[];
    player?: string;
  }

  interface Player {
    play(input: Buffer | string, callback?: (err: unknown) => void): void;
  }

  function player(options?: PlayerOptions): Player;
  export default player;
} 