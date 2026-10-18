/**
 * Base Model Class
 * Provides common CRUD operations
 */

const { pool } = require('../config/database');
const {
  redactSensitiveParams,
  describeStatement,
  REDACTED
} = require('../utils/helpers');

/**
 * Columns that must never appear on the object `BaseModel.create()` returns.
 *
 * `create()` reads the inserted row back with `SELECT *` (`findById`). For
 * `users` that row carries the bcrypt `password_hash`, and two live handlers put
 * a create() result straight into an HTTP response:
 * `POST /api/users` (src/routes/user.routes.js) and
 * `POST /api/invitations/accept` (src/controllers/invitation.controller.js).
 * Before the D-1 repair below, create() returned `null` for every caller, so
 * those responses carried no credential; once it returns the committed row they
 * would. The write accessor therefore withholds the credential itself, by name,
 * so a handler cannot leak it by forgetting to project the row.
 *
 * Deliberately NOT applied to the read accessors (`findById`, `findByField`,
 * `findAll`, `query`): `login` needs `user.password_hash` to verify a credential
 * (src/controllers/auth.controller.js) and `changePassword` needs it to compare
 * the current password.
 *
 * `invitations.token` is intentionally absent: the creating administrator must
 * receive the token in order to deliver the invitation.
 */
const PROTECTED_CREATE_COLUMNS = Object.freeze(['password_hash']);

class BaseModel {
  constructor(tableName) {
    this.tableName = tableName;
    this.pool = pool;
  }

  /**
   * Execute a query
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise}
   */
  async query(sql, params = []) {
    // Ensure all params are valid - convert undefined to null, ensure numbers are actual numbers
    const validParams = params.map(p => {
      if (p === undefined) return null;
      if (typeof p === 'number' && isNaN(p)) return null;
      if (typeof p === 'string' && p.trim() === '') return null;
      return p;
    });
    
    // ATM-001-SEC-B3B: this line used to print every bind parameter verbatim
    // (`console.log('[BASE MODEL] Params:', validParams)`), which put bcrypt
    // password hashes, invitation/API tokens and OIDC client secrets on stdout
    // for every INSERT, UPDATE, SELECT and DELETE this layer performed - including
    // statements that later failed, because the log is written before execution.
    //
    // Preserved, because operators rely on it: the statement's operation and
    // target table, the parameter count, the null-coercion outcome (undefined,
    // NaN and empty strings are normalised to null above), and every
    // non-credential value verbatim.
    //
    // Withheld: any parameter bound to a credential-adjacent column name
    // (`password_hash`, `token`, `client_secret`, ...) and any value that has the
    // shape of a credential (bcrypt hash, JWT, long opaque secret) even when its
    // column is not named in the statement text.
    const safeParams = redactSensitiveParams(sql, validParams);
    const renderedParams = safeParams
      .map((value) => (value === REDACTED ? REDACTED : JSON.stringify(value)))
      .join(', ');
    console.log(
      `[BASE MODEL] ${describeStatement(sql)} | ${safeParams.length} param(s) | ${renderedParams}`
    );
    
    // Phase 2: pg adapter returns normalized array directly (no destructuring [rows])
    const results = await this.pool.execute(sql, validParams);

    // The patched pool.execute returns a MySQL-style [rows, fields] tuple.
    // BaseModel consumers expect the plain rows array, so unwrap it here.
    if (Array.isArray(results) && results.length === 2 && Array.isArray(results[0])) {
      return results[0];
    }

    // Support both old mysql [rows] and new normalized shape
    return results;
  }

  /**
   * Find all records with optional filters
   * @param {Object} filters
   * @param {Object} options
   * @returns {Promise<Array>}
   */
  async findAll(filters = {}, options = {}) {
    let sql = `SELECT * FROM ${this.tableName}`;
    const params = [];
    const conditions = [];

    // Build WHERE clause
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        conditions.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Add ORDER BY
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
      if (options.order === 'desc') {
        sql += ' DESC';
      }
    }

    // Add LIMIT and OFFSET
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(parseInt(options.limit));

      if (options.offset) {
        sql += ` OFFSET ?`;
        params.push(parseInt(options.offset));
      }
    }

    return this.query(sql, params);
  }

  /**
   * Find one record by ID
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const res = await this.query(
      `SELECT * FROM ${this.tableName} WHERE id = ?`,
      [id]
    );
    const row = Array.isArray(res) ? res[0] : res;
    return row || null;
  }

  /**
   * Find one record by specific field
   * @param {string} field
   * @param {*} value
   * @returns {Promise<Object|null>}
   */
  async findByField(field, value) {
    const res = await this.query(
      `SELECT * FROM ${this.tableName} WHERE ${field} = ?`,
      [value]
    );
    const row = Array.isArray(res) ? res[0] : res;
    return row || null;
  }

  /**
   * Create a new record.
   *
   * DEFECT D-1 (repaired here). The INSERT previously carried no `RETURNING`
   * clause and the generated key was read from `result.insertId`:
   *
   *     INSERT INTO t (...) VALUES (...)
   *     const insertId = (result && result.insertId) || ...;
   *     return this.findById(insertId);
   *
   * The only runtime driver is PostgreSQL (`pg`, see src/config/database.js).
   * A `pg` Result carries no `insertId`; `normalizeResult()` can only populate
   * one from a row the statement returned (`rows[0].id`). With no `RETURNING`,
   * `rows` is empty, `insertId` stays null and `findById(null)` matches
   * nothing - so `create()` returned `null` for EVERY caller while the INSERT
   * had already committed on an autocommit pool connection. Callers then threw
   * on `.id` after a durable write (the observed failure:
   * `InvitationModel.createInvitation` -> `result.id` on null).
   *
   * `RETURNING id` makes the write observable: either the INSERT reports the
   * generated key, or this method throws instead of returning a value the
   * caller must not treat as success. Every BaseModel table has an identity
   * `id` column (database/postgresql/), so the clause is always satisfiable.
   *
   * The returned row has PROTECTED_CREATE_COLUMNS removed; see the constant.
   *
   * @param {Object} data
   * @returns {Promise<Object>} the committed row, with PROTECTED_CREATE_COLUMNS removed
   */
  async create(data) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map(() => '?').join(', ');

    const sql = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`;
    const result = await this.query(sql, values);

    const insertId = result && result.insertId;
    if (insertId === null || insertId === undefined) {
      throw new Error(
        `INSERT INTO ${this.tableName} completed without reporting a generated id`
      );
    }

    const row = await this.findById(insertId);
    if (!row) return row;

    const projected = { ...row };
    for (const column of PROTECTED_CREATE_COLUMNS) delete projected[column];
    return projected;
  }

  /**
   * Update a record by ID
   * @param {number} id
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async update(id, data) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');

    const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
    await this.query(sql, [...values, id]);

    return this.findById(id);
  }

  /**
   * Delete a record by ID
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const result = await this.query(
      `DELETE FROM ${this.tableName} WHERE id = ?`,
      [id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Count records with optional filters
   * @param {Object} filters
   * @returns {Promise<number>}
   */
  async count(filters = {}) {
    let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`;
    const params = [];
    const conditions = [];

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        conditions.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    const [result] = await this.query(sql, params);
    return result.count;
  }
}

module.exports = BaseModel;
