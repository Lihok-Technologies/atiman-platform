/**
 * Base Model Class
 * Provides common CRUD operations
 */

const { pool } = require('../config/database');

/**
 * Columns that must never appear on the object `BaseModel.create()` returns.
 *
 * `create()` reads the committed row back with `SELECT *` (`findById`). For
 * `users` that row carries `password_hash`, and several callers place a create()
 * result straight into an HTTP response (`POST /api/invitations/accept`,
 * `POST /api/users`). Redaction therefore belongs to the write accessor itself,
 * applied by name at the class level, so a caller cannot leak a credential by
 * forgetting to project the row.
 *
 * This is deliberately NOT applied to the read accessors (`findById`,
 * `findByField`, `findAll`, `query`): `changePassword`
 * (src/controllers/auth.controller.js) must read `user.password_hash` in order
 * to compare the current password, and `login` reads it to verify a credential.
 *
 * `invitations.token` is intentionally absent: an invitation token is a value
 * the creating administrator must receive in order to deliver the invitation, and
 * only the administration LISTING withholds it (ATM-001-SEC-00G).
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
   * @param {Object} [conn] Optional transaction connection from
   *   `pool.getConnection()` / `getConnection()`. When supplied the statement runs
   *   on that connection so it takes part in the caller's transaction; when
   *   omitted it runs on the pool exactly as before.
   * @returns {Promise}
   */
  async query(sql, params = [], conn = null) {
    // Ensure all params are valid - convert undefined to null, ensure numbers are actual numbers
    const validParams = params.map(p => {
      if (p === undefined) return null;
      if (typeof p === 'number' && isNaN(p)) return null;
      if (typeof p === 'string' && p.trim() === '') return null;
      return p;
    });
    
    console.log('[BASE MODEL] Params:', validParams);
    
    // Phase 2: pg adapter returns normalized array directly (no destructuring [rows]).
    // A transaction connection already returns unwrapped rows; the pool returns the
    // mysql2-style [rows, fields] tuple. Both shapes are handled below.
    const results = conn
      ? await conn.execute(sql, validParams)
      : await this.pool.execute(sql, validParams);

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
   * @param {Object} [conn] Optional transaction connection (see query()).
   * @returns {Promise<Object|null>}
   */
  async findById(id, conn = null) {
    const res = await this.query(
      `SELECT * FROM ${this.tableName} WHERE id = ?`,
      [id],
      conn
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
   * The runtime driver is PostgreSQL (`pg`, see src/config/database.js). A `pg`
   * Result carries no `insertId`; `normalizeResult()` in
   * src/config/database.js can only populate one from a row returned by the
   * statement (`rows[0].id`). With no `RETURNING`, `rows` is empty, `insertId`
   * stays null and `findById(null)` matches nothing - so `create()` returned
   * `null` for EVERY caller while the INSERT had already committed on an
   * autocommit pool connection. Callers then threw on `.id` AFTER a durable
   * write, which is how `POST /api/auth/organization-signup` committed an orphan
   * organization and answered HTTP 500.
   *
   * `RETURNING id` makes the write observable: either the INSERT reports the
   * generated key, or this method throws instead of returning a value the caller
   * must not treat as success. Every BaseModel table has an identity `id` column
   * (database/postgresql/001_core.sql), so the clause is always satisfiable.
   *
   * Callers that require the INSERT and their follow-up writes to be atomic must
   * pass a transaction connection (`conn`) and commit it themselves; see
   * `organizationSignup` and `InvitationController.accept`.
   *
   * @param {Object} data
   * @param {Object} [conn] Optional transaction connection (see query()).
   * @returns {Promise<Object>} the committed row, with PROTECTED_CREATE_COLUMNS removed
   */
  async create(data, conn = null) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map(() => '?').join(', ');

    const sql = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`;
    const result = await this.query(sql, values, conn);

    const insertId = result && result.insertId;
    if (insertId === null || insertId === undefined) {
      throw new Error(
        `INSERT INTO ${this.tableName} committed without reporting a generated id`
      );
    }

    const row = await this.findById(insertId, conn);
    if (!row) return row;

    const projected = { ...row };
    for (const column of PROTECTED_CREATE_COLUMNS) delete projected[column];
    return projected;
  }

  /**
   * Update a record by ID
   * @param {number} id
   * @param {Object} data
   * @param {Object} [conn] Optional transaction connection (see query()).
   * @returns {Promise<Object>}
   */
  async update(id, data, conn = null) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');

    const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
    await this.query(sql, [...values, id], conn);

    return this.findById(id, conn);
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
