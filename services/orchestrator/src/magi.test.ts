import { MagiName, PERSONAS_CONFIG } from './magi';

describe('Magi Configuration', () => {
  it('should have all three Magi personas configured', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Melchior]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Caspar]).toBeDefined();
  });

  it('should have correct temperature settings', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar].options.temperature).toBe(0.2);
    expect(PERSONAS_CONFIG[MagiName.Melchior].options.temperature).toBe(0.9);
    expect(PERSONAS_CONFIG[MagiName.Caspar].options.temperature).toBe(0.7);
  });
});