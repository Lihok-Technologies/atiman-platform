/**
 * Models Index
 * Central export for all models
 */

module.exports = {
  User: require('./user.model'),
  Organization: require('./organization.model'),
  OrganizationSubscription: require('./organization-subscription.model'),
  SubscriptionPlan: require('./subscription-plan.model'),
  Invitation: require('./invitation.model'),
  Facility: require('./facility.model'),
  Equipment: require('./equipment.model'),
  TaskMaster: require('./task.model'),
  Schedule: require('./schedule.model'),
  WorkOrder: require('./work-order.model'),
  Inspection: require('./inspection.model'),
  // ISO 14224 Equipment Hierarchy
  ...require('./iso-equipment.model'),
  // ISO 14224 Levels 4-5
  ...require('./subunit.model'),
  // Task Templates
  ...require('./task-template.model'),
  // ODM Findings with SAP Catalog Support
  Finding: require('./finding.model'),
  // Atiman finding assessment (Operator Corrected / Monitor / Escalate)
  FindingAssessment: require('./finding-assessment.model'),
  // SAP S/4HANA PM Catalogs (A, B, C, 5)
  ...require('./sap-catalog.model'),
  // Inspection Results
  InspectionResult: require('./inspection-result.model'),
  // Subscription-based features
  CustomField: require('./custom-field.model'),
  SSOConfig: require('./sso-config.model'),
  AuditLog: require('./audit-log.model'),
  ApiKey: require('./api-key.model'),
  // Industry Layer (Step 2)
  Industry: require('./industry.model')
};
