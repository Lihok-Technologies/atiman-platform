/**
 * Utility Helper Functions
 */

const bcrypt = require('bcryptjs');
const authConfig = require('../config/auth');

/**
 * Hash a password
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, authConfig.bcrypt.saltRounds);
};

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>}
 */
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate unique code with prefix
 * @param {string} prefix - Code prefix (e.g., 'WO', 'EQ')
 * @param {number} id - ID to include in code
 * @param {number} padding - Number padding (default 4)
 * @returns {string}
 */
const generateCode = (prefix, id, padding = 4) => {
  const year = new Date().getFullYear();
  const paddedId = String(id).padStart(padding, '0');
  return `${prefix}-${year}-${paddedId}`;
};

/**
 * Format date for MySQL
 * @param {Date|string} date
 * @returns {string}
 */
const formatDateForMySQL = (date) => {
  const d = new Date(date);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

/**
 * Calculate next due date based on frequency
 * @param {Date} currentDate
 * @param {string} frequencyType
 * @param {number} frequencyValue
 * @returns {Date}
 */
const calculateNextDueDate = (currentDate, frequencyType, frequencyValue = 1) => {
  const date = new Date(currentDate);
  
  switch (frequencyType) {
    case 'daily':
      date.setDate(date.getDate() + frequencyValue);
      break;
    case 'weekly':
      date.setDate(date.getDate() + (frequencyValue * 7));
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + frequencyValue);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + (frequencyValue * 3));
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + frequencyValue);
      break;
    default:
      date.setDate(date.getDate() + 1);
  }
  
  return date;
};

/**
 * Credential material that must never appear in an API response.
 *
 * Two complementary rules. Redaction is name-based and fails closed for a
 * credential-adjacent name: it withholds any field whose name contains a
 * credential word as a delimited segment, even when that field is metadata rather
 * than a secret (for example `password_expires_at`). Withholding a
 * non-sensitive field is recoverable; leaking a credential is not.
 *
 *  1. `SENSITIVE_FIELD_PATTERN` matches a sensitive word that is a whole
 *     `_`/`-` delimited segment of the field name - the naming convention the
 *     database rows actually use (`password_hash`, `reset_token`).
 *  2. `SENSITIVE_FIELD_NAMES` enumerates the remaining concrete spellings:
 *     camelCase variants (`refreshToken`), plurals (`credentials`) and
 *     abbreviations. Redaction is deliberately NOT a blanket substring match, so
 *     a permission resource key such as `API_KEYS` is not mistaken for `api_key`.
 *     `api_keys`/`apikeys` are likewise absent: that is the name of a real
 *     resource in this codebase (the `api_keys` table and its route module), so a
 *     response key of that name identifies a collection of key metadata rather
 *     than a secret value.
 */
const SENSITIVE_FIELD_PATTERN = /(?:^|[_-])(?:password|passwd|secret|token|credential|api_?key|private_?key)(?:$|[_-])/i;

const SENSITIVE_FIELD_NAMES = new Set([
  // password / passphrase material
  'password', 'passwd', 'pwd', 'passwordhash', 'password_hash', 'passwd_hash',
  'password_confirmation', 'confirm_password', 'current_password', 'new_password', 'old_password',
  'passphrase', 'salt', 'password_salt',
  // short-code credentials
  'pin', 'pin_hash', 'pin_code', 'otp', 'otp_hash', 'one_time_code', 'backup_codes', 'recovery_codes',
  // password-reset and other authentication tokens
  'password_reset', 'password_reset_token', 'reset_password_token', 'reset_token',
  'password_reset_expires', 'password_reset_expires_at',
  'accesstoken', 'access_token', 'refreshtoken', 'refresh_token', 'idtoken', 'id_token',
  'invitation_token', 'invite_token', 'verification_token', 'email_verification_token',
  'sessiontoken', 'session_token', 'session_key', 'sso_token', 'csrf_token', 'tokens',
  // shared secrets and private keys
  'secret', 'secrets', 'clientsecret', 'client_secret', 'jwt_secret', 'sso_secret',
  'signing_key', 'privatekey', 'private_key', 'encryption_key', 'key_hash',
  'license_key', 'api_key', 'apikey', 'api_key_hash',
  // multi-factor material
  'mfa_secret', 'two_factor_secret', 'two_factor_code', 'totp_secret', 'otp_secret', 'otp_code',
  // generic credential containers
  'credential', 'credentials'
]);

const isSensitiveField = (fieldName) => {
  const name = String(fieldName);
  return SENSITIVE_FIELD_NAMES.has(name.toLowerCase()) || SENSITIVE_FIELD_PATTERN.test(name);
};

/**
 * Deep-copy a JSON-bound value with every sensitive field removed.
 *
 * This is the defence-in-depth primitive: it walks nested objects and arrays
 * (so `{ data: { users: [...] } }` is covered), never mutates its input, and
 * passes non-plain values such as Date through unchanged.
 *
 * @param {*} value
 * @returns {*}
 */
const redactSensitiveFields = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveFields(entry));
  }
  if (value === null || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveField(key)) continue;
    redacted[key] = redactSensitiveFields(entry);
  }
  return redacted;
};

/**
 * Sanitize user object (remove sensitive data)
 * @param {Object|Array} user
 * @returns {Object|Array}
 */
const sanitizeUser = (user) => redactSensitiveFields(user);

/**
 * Parse JSON safely
 * @param {string} jsonString
 * @param {*} defaultValue
 * @returns {*}
 */
const safeJsonParse = (jsonString, defaultValue = null) => {
  try {
    return JSON.parse(jsonString);
  } catch {
    return defaultValue;
  }
};

/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Generate pagination metadata
 * @param {number} page
 * @param {number} limit
 * @param {number} total
 * @returns {Object}
 */
const getPaginationMeta = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1
  };
};

module.exports = {
  hashPassword,
  comparePassword,
  generateCode,
  formatDateForMySQL,
  calculateNextDueDate,
  sanitizeUser,
  redactSensitiveFields,
  isSensitiveField,
  safeJsonParse,
  isValidEmail,
  getPaginationMeta
};
