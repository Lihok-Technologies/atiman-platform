/**
 * Role-Based Access Control (RBAC) Configuration
 * 
 * Roles: admin, supervisor, operator
 * 
 * Permission Levels:
 * - 'all' - Can perform action on any record
 * - 'own' - Can only perform action on own records
 * - 'none' - Cannot perform action
 */

const PERMISSIONS = {
  // User Management
  USERS: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'none' },
    CREATE: { admin: 'all', supervisor: 'all', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'own', operator: 'own' },
    DELETE: { admin: 'all', supervisor: 'none', operator: 'none' },
    ASSIGN_FACILITY: { admin: 'all', supervisor: 'none', operator: 'none' }
  },

  // Work Orders
  WORK_ORDERS: {
    VIEW_ALL: { admin: 'all', supervisor: 'all', operator: 'none' },
    VIEW_OWN: { admin: 'all', supervisor: 'all', operator: 'all' },
    CREATE: { admin: 'all', supervisor: 'all', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'all', operator: 'none' },
    DELETE: { admin: 'all', supervisor: 'none', operator: 'none' },
    ASSIGN: { admin: 'all', supervisor: 'all', operator: 'none' },
    UPDATE_STATUS: { admin: 'all', supervisor: 'all', operator: 'own' },
    ADD_NOTES: { admin: 'all', supervisor: 'all', operator: 'own' }
  },

  // Inspections
  INSPECTIONS: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    // Admins CANNOT perform inspections - they can only manage work orders
    SUBMIT: { admin: 'none', supervisor: 'all', operator: 'all' },
    SUBMIT_READINGS: { admin: 'none', supervisor: 'all', operator: 'own' },
    MANAGE_POINTS: { admin: 'all', supervisor: 'all', operator: 'none' },
    EDIT_READINGS: { admin: 'all', supervisor: 'all', operator: 'none' }
  },

  // Findings (ODM Defects)
  FINDINGS: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    CREATE: { admin: 'all', supervisor: 'all', operator: 'all' },
    MANAGE: { admin: 'all', supervisor: 'all', operator: 'none' },
    LINK_SAP: { admin: 'all', supervisor: 'all', operator: 'none' },
    // Assessment stage (ATM-000 9-10, ATM-002 7.2-7.3, 8.2-8.3).
    // Operators may recommend an outcome; the accountable confirmation belongs
    // to supervisor/admin, who own escalation decisions (ATM-002 8.3).
    VIEW_ASSESSMENT: { admin: 'all', supervisor: 'all', operator: 'all' },
    RECOMMEND_OUTCOME: { admin: 'all', supervisor: 'all', operator: 'all' },
    CONFIRM_OUTCOME: { admin: 'all', supervisor: 'all', operator: 'none' }
  },

  // SAP Catalogs
  CATALOGS: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' }
  },

  // Equipment
  EQUIPMENT: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    CREATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    DELETE: { admin: 'all', supervisor: 'none', operator: 'none' }
  },

  // Facilities
  FACILITIES: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    CREATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    DELETE: { admin: 'all', supervisor: 'none', operator: 'none' }
  },

  // Schedules
  SCHEDULES: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    CREATE: { admin: 'all', supervisor: 'all', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'all', operator: 'none' },
    DELETE: { admin: 'all', supervisor: 'all', operator: 'none' }
  },

  // Tasks (Task Master)
  TASKS: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    CREATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    DELETE: { admin: 'all', supervisor: 'none', operator: 'none' }
  },

  // Reports
  REPORTS: {
    VIEW: { admin: 'all', supervisor: 'all', operator: 'all' },
    EXPORT: { admin: 'all', supervisor: 'all', operator: 'none' }
  },

  // Subscriptions (Payment/Plan management)
  SUBSCRIPTION: {
    VIEW: { admin: 'all', supervisor: 'none', operator: 'none' },
    UPDATE: { admin: 'all', supervisor: 'none', operator: 'none' },
    CANCEL: { admin: 'all', supervisor: 'none', operator: 'none' }
  }
};

/**
 * Check if a role has a specific permission
 * @param {string} role - User role (admin, supervisor, operator)
 * @param {string} resource - Resource name (e.g., 'WORK_ORDERS')
 * @param {string} action - Action name (e.g., 'CREATE')
 * @returns {string} - 'all', 'own', or 'none'
 */
function checkPermission(role, resource, action) {
  if (!PERMISSIONS[resource] || !PERMISSIONS[resource][action]) {
    return 'none';
  }
  return PERMISSIONS[resource][action][role] || 'none';
}

/**
 * Check if role has permission (returns boolean)
 * @param {string} role - User role
 * @param {string} resource - Resource name
 * @param {string} action - Action name
 * @param {boolean} isOwn - Whether the resource belongs to the user
 * @returns {boolean}
 */
function hasPermission(role, resource, action, isOwn = false) {
  const level = checkPermission(role, resource, action);
  if (level === 'all') return true;
  if (level === 'own' && isOwn) return true;
  return false;
}

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {Object}
 */
function getRolePermissions(role) {
  const result = {};
  for (const [resource, actions] of Object.entries(PERMISSIONS)) {
    result[resource] = {};
    for (const [action, levels] of Object.entries(actions)) {
      result[resource][action] = levels[role] || 'none';
    }
  }
  return result;
}

module.exports = {
  PERMISSIONS,
  checkPermission,
  hasPermission,
  getRolePermissions
};
