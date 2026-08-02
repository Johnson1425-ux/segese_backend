import { validatePassword, MIN_PASSWORD_LENGTH } from '../utils/passwordPolicy.js';

describe('validatePassword', () => {
  it('accepts a password meeting every rule', () => {
    expect(validatePassword('Str0ng!Pass').valid).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!x'],
    ['no uppercase', 'str0ng!pass'],
    ['no lowercase', 'STR0NG!PASS'],
    ['no digit', 'Strong!Pass'],
    ['no special character', 'Str0ngPass'],
  ])('rejects a password with %s', (_label, password) => {
    const result = validatePassword(password);
    expect(result.valid).toBe(false);
    expect(result.message).toEqual(expect.any(String));
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 12345678],
    ['an object', {}],
  ])('rejects %s rather than throwing', (_label, value) => {
    expect(validatePassword(value).valid).toBe(false);
  });

  it('allows special characters outside the original character class', () => {
    // The previous regex ended with [A-Za-z\d@$!%*?&], which only constrained
    // the first character, and implied a narrow allowed set. Passphrases using
    // other punctuation are legitimate and must pass.
    expect(validatePassword('Str0ng#Pass~2026').valid).toBe(true);
  });

  it('accepts a password of exactly the minimum length', () => {
    const atMinimum = 'Ab1!' + 'x'.repeat(MIN_PASSWORD_LENGTH - 4);
    expect(atMinimum).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(validatePassword(atMinimum).valid).toBe(true);
  });
});
