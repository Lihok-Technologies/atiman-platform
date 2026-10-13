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
 * Credential material that must never appear in an API response or in a log line.
 *
 * Two complementary rules. Redaction is name-based and fails closed for a
 * credential-adjacent name: it withholds any field whose name contains a
 * credential word as a delimited segment, even when that field is metadata rather
 * than a secret (for example `password_expires_at`). Withholding a non-sensitive
 * field is recoverable; leaking a credential is not.
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
 * Sanitize user object (remove sensitive data) - deep and non-mutating.
 *
 * ATM-001-SEC-B3B: this was a single-field destructure that removed only a
 * top-level `password_hash`, so a user row nested inside an envelope kept its
 * credential, and a `null` input threw a TypeError. It now delegates to
 * `redactSensitiveFields`, which walks nested objects and arrays.
 *
 * @param {Object|Array} user
 * @returns {Object|Array}
 */
const sanitizeUser = (user) => redactSensitiveFields(user);

/**
 * Values that are credentials regardless of the column they are bound to.
 *
 * The name-based rule in `isSensitiveField` can only fire when the bound column
 * name is known. A raw `SELECT ... WHERE some_column = ?` carries no such name in
 * the SQL text, so the logging redactor also withholds any value that has the
 * SHAPE of a credential:
 *
 *   - a bcrypt hash (`$2a$10$...`),
 *   - a JWT or similar signed token (`eyJ...eyJ...`),
 *   - a long opaque secret (40+ characters of base64url, hex, or a UUID-like run).
 *
 * This is deliberately over-inclusive. A long non-secret value (a description, a
 * base64 blob) is withheld from the debug log, which is recoverable; printing a
 * credential to stdout is not.
 */
const CREDENTIAL_VALUE_SOURCES = [
  '\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{53}', // bcrypt
  'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}[A-Za-z0-9_.-]*', // JWT / signed token
  '[A-Fa-f0-9]{40,}', // long hex secret
  '[A-Za-z0-9_-]{40,}' // long opaque base64url secret or bearer token
];

const CREDENTIAL_VALUE_PATTERN = new RegExp(`^(?:${CREDENTIAL_VALUE_SOURCES.join('|')})$`);

const looksLikeCredentialValue = (value) => typeof value === 'string' && CREDENTIAL_VALUE_PATTERN.test(value);

const REDACTED = '[REDACTED]';

/**
 * Withhold credential-shaped substrings from a blob of text that is about to be
 * logged.
 *
 * This exists because a database driver can echo a bind parameter back inside an
 * error: `pg` reports a failed cast as
 * `invalid input syntax for type integer: "<the value>"`. An error logger that
 * prints the whole error object therefore prints the value - so the same
 * over-inclusive shapes used for parameter logging are applied to the text.
 *
 * @param {string} text
 * @returns {string}
 */
const CREDENTIAL_TEXT_PATTERN = new RegExp(CREDENTIAL_VALUE_SOURCES.join('|'), 'g');

const redactCredentialText = (text) => String(text).replace(CREDENTIAL_TEXT_PATTERN, REDACTED);

/**
 * Name the bind parameter at each `?` placeholder of a statement, as far as the
 * SQL text makes that unambiguous.
 *
 * Recognised forms (the shapes this codebase's BaseModel emits):
 *   INSERT INTO t (a, b, c) VALUES (?, ?, ?)
 *   UPDATE t SET a = ?, b = ? WHERE id = ?
 *   ... WHERE col = ?        (and `col IN (?, ?)`)
 *
 * Returns an array of length `paramCount`. An entry is a column name, or `null`
 * where the SQL text does not name the parameter (for example a positional
 * parameter inside a function call or a subquery). `null` is a legitimate
 * answer: the caller then falls back to shape detection rather than assuming the
 * value is safe.
 *
 * @param {string} sql
 * @param {number} paramCount
 * @returns {Array<string|null>}
 */
const boundParamNames = (sql, paramCount) => {
  const names = new Array(paramCount).fill(null);
  const text = String(sql || '');
  if (paramCount === 0) return names;

  // INSERT INTO <table> (col, col, ...) VALUES (?, ?, ...)
  const insert = /INSERT\s+INTO\s+[\w."]+\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(text);
  if (insert) {
    const columns = insert[1].split(',').map((c) => c.replace(/["`\s]/g, '')).filter(Boolean);
    const slots = insert[2].split(',').map((s) => s.trim());
    slots.forEach((slot, index) => {
      if (slot === '?' && columns[index] && index < paramCount) names[index] = columns[index];
    });
    return names;
  }

  // Every `col = ?` / `col IN (?, ...)` in the statement, in placeholder order.
  //
  // The `SET` clause of an UPDATE uses the same `col = ?` spelling as a `WHERE`
  // predicate, so one scan covers both. Each match owns the placeholders that
  // start at the count of `?` appearing before the column name - an absolute
  // offset, so a predicate is never attributed to a position an earlier clause
  // already consumed.
  const placeholdersBefore = (index) => (text.slice(0, index).match(/\?/g) || []).length;
  const conditionPattern = /([\w."]+)\s*(?:=\s*\?|IN\s*\(([^)]*)\))/gi;
  let match;
  while ((match = conditionPattern.exec(text)) !== null) {
    const column = match[1].replace(/["`]/g, '');
    const owned = match[2] === undefined ? 1 : (match[2].match(/\?/g) || []).length;
    const first = placeholdersBefore(match.index);
    for (let i = 0; i < owned; i += 1) {
      const position = first + i;
      if (position < paramCount && names[position] === null) names[position] = column;
    }
  }

  return names;
};

/**
 * Build the safe, loggable view of a statement's bind parameters.
 *
 * A value is withheld when its position was named by a credential-adjacent
 * column (`boundParamNames`) or when the value itself has the shape of a
 * credential (`looksLikeCredentialValue`). Everything else is returned verbatim,
 * so a debug log keeps its diagnostic value.
 *
 * @param {string} sql
 * @param {Array} params
 * @returns {Array<*>}
 */
const redactSensitiveParams = (sql, params = []) => {
  const names = boundParamNames(sql, params.length);
  return params.map((value, index) => {
    if (isSensitiveField(names[index] || '')) return REDACTED;
    if (looksLikeCredentialValue(value)) return REDACTED;
    return value;
  });
};

/**
 * The statement operation and target table, for a log line that carries no
 * parameter values at all.
 *
 * @param {string} sql
 * @returns {string}
 */
const describeStatement = (sql) => {
  const text = String(sql || '').trim().replace(/\s+/g, ' ');
  const match = /^(SELECT|INSERT|UPDATE|DELETE)\b/i.exec(text);
  const operation = match ? match[1].toUpperCase() : 'STATEMENT';
  let table = '';
  if (operation === 'INSERT' || operation === 'UPDATE') {
    const t = new RegExp(operation + '\\s+(?:INTO\\s+)?([\\w."]+)', 'i').exec(text);
    table = t ? t[1].replace(/["`]/g, '') : '';
  } else if (operation === 'DELETE') {
    const t = /DELETE\s+FROM\s+([\w."]+)/i.exec(text);
    table = t ? t[1].replace(/["`]/g, '') : '';
  } else {
    const t = /FROM\s+([\w."]+)/i.exec(text);
    table = t ? t[1].replace(/["`]/g, '') : '';
  }
  return table ? `${operation} ${table}` : operation;
};

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
  looksLikeCredentialValue,
  redactCredentialText,
  boundParamNames,
  redactSensitiveParams,
  describeStatement,
  REDACTED,
  safeJsonParse,
  isValidEmail,
  getPaginationMeta
};
