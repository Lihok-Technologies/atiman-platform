/**
 * Knowledge Pack Controller
 *
 * ATM-001 M4 — HTTP translation for governed Knowledge Pack authoring,
 * composition, review, approval and publication.
 *
 * The controller owns no domain rule and no SQL. It resolves the authenticated
 * principal, calls the model, and translates domain errors into responses.
 *
 * The identity used for review, approval and publication is ALWAYS the
 * authenticated principal (req.user.id). It is never read from the request
 * body: an accountable act cannot be attributed to a caller-supplied user.
 */

const { KnowledgePack, KnowledgePackVersion } = require('../models/knowledge-pack.model');
const {
  PackValidationError,
  PackAdmissionError,
  PackNotFoundError,
  PackConflictError
} = require('../services/knowledge-pack.service');

/** The authenticated principal, or null. */
const actorId = (req) => (req.user && req.user.id ? req.user.id : null);

const asInt = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

/**
 * Translate a domain error into a response.
 *
 * The publication admission gate deliberately reports EVERY reason it found, so
 * a rejected release is correctable rather than a guessing game (M1 precedent).
 */
function respondToError(error, res, next) {
  if (error instanceof PackAdmissionError || error.code === 'PACK_PUBLICATION_ADMISSION_FAILED') {
    return res.status(409).json({
      success: false,
      message: error.message,
      code: 'PACK_PUBLICATION_ADMISSION_FAILED',
      failures: error.failures
    });
  }
  if (error instanceof PackValidationError || error.code === 'PACK_VALIDATION_FAILED') {
    return res.status(400).json({
      success: false,
      message: error.message,
      code: 'PACK_VALIDATION_FAILED',
      failures: error.failures
    });
  }
  if (error instanceof PackNotFoundError || error.statusCode === 404) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error instanceof PackConflictError || error.statusCode === 409) {
    return res.status(409).json({
      success: false,
      message: error.message,
      code: error.code || 'PACK_CONFLICT'
    });
  }
  return next(error);
}

/** Resolve the Pack addressed by the route, or respond 404. */
async function requirePack(req, res) {
  const packId = asInt(req.params.packId);
  if (packId === null) {
    res.status(400).json({ success: false, message: 'A valid pack id is required' });
    return null;
  }
  const pack = await KnowledgePack.findPackById(packId);
  if (!pack) {
    res.status(404).json({ success: false, message: 'Knowledge pack not found' });
    return null;
  }
  return pack;
}

/** Resolve the Pack version ONLY within the addressed Pack, or respond 404. */
async function requireVersion(req, res, packId) {
  const versionId = asInt(req.params.versionId);
  if (versionId === null) {
    res.status(400).json({ success: false, message: 'A valid pack version id is required' });
    return null;
  }
  const version = await KnowledgePackVersion.findVersionInPack(packId, versionId);
  if (!version) {
    res.status(404).json({ success: false, message: 'Knowledge pack version not found' });
    return null;
  }
  return version;
}

// ------------------------------------------------------------------ pack root

exports.createPack = async (req, res, next) => {
  try {
    const pack = await KnowledgePack.createPack(
      {
        packCode: req.body.pack_code,
        packName: req.body.pack_name,
        description: req.body.description
      },
      { userId: actorId(req) }
    );
    return res.status(201).json({
      success: true,
      message: 'Knowledge pack created successfully',
      data: pack
    });
  } catch (error) {
    if (error.code === '23505' || /duplicate key value/i.test(error.message || '')) {
      return res.status(409).json({
        success: false,
        message: 'A knowledge pack with that pack code already exists',
        code: 'PACK_CODE_ALREADY_EXISTS'
      });
    }
    return respondToError(error, res, next);
  }
};

exports.listPacks = async (req, res, next) => {
  try {
    const packs = await KnowledgePack.listPacks({
      limit: req.query.limit,
      offset: req.query.offset
    });
    return res.json({ success: true, data: packs });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.getPack = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const versions = await KnowledgePackVersion.listVersions(pack.id);
    return res.json({ success: true, data: { ...pack, versions } });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

// ------------------------------------------------------------ pack versions

exports.createVersion = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await KnowledgePackVersion.createVersion(
      pack.id,
      { versionNumber: req.body.version_number },
      { userId: actorId(req) }
    );
    return res.status(201).json({
      success: true,
      message: 'Knowledge pack version created successfully',
      data: version
    });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.listVersions = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const versions = await KnowledgePackVersion.listVersions(pack.id);
    return res.json({ success: true, data: versions });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.getVersion = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;
    const members = await KnowledgePackVersion.listMembers(pack.id, version.id);
    return res.json({ success: true, data: { ...version, members } });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

// -------------------------------------------------------------- membership

exports.listMembers = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;
    const members = await KnowledgePackVersion.listMembers(pack.id, version.id);
    return res.json({ success: true, data: members });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.addMember = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;

    const taskTemplateVersionId = asInt(req.body.task_template_version_id);
    if (taskTemplateVersionId === null) {
      return res.status(400).json({
        success: false,
        message: 'A valid task_template_version_id is required'
      });
    }

    const membershipId = await KnowledgePackVersion.addMember(
      pack.id, version.id, taskTemplateVersionId, actorId(req)
    );
    return res.status(201).json({
      success: true,
      message: 'Task template version added to the knowledge pack version',
      data: { id: membershipId, task_template_version_id: taskTemplateVersionId }
    });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.removeMember = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;

    const membershipId = asInt(req.params.membershipId);
    if (membershipId === null) {
      return res.status(400).json({ success: false, message: 'A valid membership id is required' });
    }

    await KnowledgePackVersion.removeMember(pack.id, version.id, membershipId);
    return res.json({ success: true, message: 'Membership removed' });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

// ---------------------------------------------------------------- lifecycle

exports.submitForReview = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;

    const updated = await KnowledgePackVersion.submitForReview(pack.id, version.id);
    return res.json({
      success: true,
      message: 'Knowledge pack version submitted for review',
      data: updated
    });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.recordReview = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;

    const updated = await KnowledgePackVersion.recordReview(pack.id, version.id, actorId(req));
    return res.json({
      success: true,
      message: 'Knowledge pack version review recorded',
      data: updated
    });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

exports.approveVersion = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;

    const updated = await KnowledgePackVersion.approveVersion(pack.id, version.id, actorId(req));
    return res.json({
      success: true,
      message: 'Knowledge pack version approved',
      data: updated
    });
  } catch (error) {
    return respondToError(error, res, next);
  }
};

/**
 * Publish a Pack version through the governed admission boundary.
 *
 * The publisher is the authenticated principal. Because migration 015 forbids
 * the approver from being the publisher, a caller who approved this version
 * will be refused here — by the admission gate with an actionable reason, and
 * by the database CHECK as the durable invariant.
 */
exports.publishVersion = async (req, res, next) => {
  try {
    const pack = await requirePack(req, res);
    if (!pack) return undefined;
    const version = await requireVersion(req, res, pack.id);
    if (!version) return undefined;

    const published = await KnowledgePackVersion.publishVersion(
      pack.id, version.id, actorId(req)
    );
    return res.status(201).json({
      success: true,
      message: 'Knowledge pack version published successfully',
      data: published
    });
  } catch (error) {
    return respondToError(error, res, next);
  }
};
