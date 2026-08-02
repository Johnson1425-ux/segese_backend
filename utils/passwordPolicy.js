/**
 * Single definition of the password policy.
 *
 * The rules were previously spelled out separately in routes/auth.js,
 * routes/users.js and models/User.js, and had drifted apart (the model
 * accepted 6 characters while the endpoints required 8 plus complexity).
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The original rule demanded one of `@$!%*?&` specifically, so a password
 * using any other punctuation — `#`, `~`, `-` — was rejected despite being
 * just as strong. Any non-alphanumeric character now satisfies the
 * requirement, which only widens what is accepted.
 */
const COMPLEXITY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  `Password must be at least ${MIN_PASSWORD_LENGTH} characters and contain an uppercase letter, ` +
  'a lowercase letter, a number, and a special character';

/**
 * Validate a candidate password.
 *
 * @param {string} password
 * @returns {{ valid: boolean, message?: string }}
 */
export const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, message: PASSWORD_REQUIREMENTS_MESSAGE };
  }

  if (!COMPLEXITY.test(password)) {
    return { valid: false, message: PASSWORD_REQUIREMENTS_MESSAGE };
  }

  return { valid: true };
};

export default validatePassword;
