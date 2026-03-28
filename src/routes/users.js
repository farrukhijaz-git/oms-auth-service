const express = require('express');
const requireJwt = require('../middleware/requireJwt');
const requireAdmin = require('../middleware/requireAdmin');
const pool = require('../db');

const router = express.Router();

router.use(requireJwt, requireAdmin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(['admin', 'staff']);

function err(code, message) {
  return { error: { code, message } };
}

// ---------------------------------------------------------------------------
// GET /admin/users — list all users
// ---------------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, google_email, display_name, role, is_active, invited_by, created_at, last_login_at
       FROM app.users
       ORDER BY created_at DESC`
    );
    return res.json({ users: rows });
  } catch (e) {
    console.error('GET /admin/users:', e);
    return res.status(500).json(err('INTERNAL_ERROR', 'Failed to retrieve users'));
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users — invite a new user
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { google_email, role, display_name } = req.body;

  // Validate presence
  if (!google_email || !role) {
    return res.status(400).json(err('VALIDATION_ERROR', 'google_email and role are required'));
  }

  // Validate email format
  if (!EMAIL_RE.test(google_email)) {
    return res.status(400).json(err('VALIDATION_ERROR', 'google_email must be a valid email address'));
  }

  // Validate role
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json(err('VALIDATION_ERROR', "role must be 'admin' or 'staff'"));
  }

  try {
    // Duplicate check
    const { rows: existing } = await pool.query(
      'SELECT id FROM app.users WHERE google_email = $1',
      [google_email]
    );

    if (existing.length > 0) {
      return res.status(409).json(err('DUPLICATE_EMAIL', 'A user with that email already exists'));
    }

    const { rows } = await pool.query(
      `INSERT INTO app.users (google_email, display_name, role, invited_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, google_email, display_name, role, is_active, created_at`,
      [google_email, display_name || null, role, req.user.user_id]
    );

    return res.status(201).json({ user: rows[0] });
  } catch (e) {
    console.error('POST /admin/users:', e);
    return res.status(500).json(err('INTERNAL_ERROR', 'Failed to create user'));
  }
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id — update role and/or is_active
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { role, is_active } = req.body;

  // Must supply at least one field
  if (role === undefined && is_active === undefined) {
    return res.status(400).json(err('VALIDATION_ERROR', 'Provide role and/or is_active to update'));
  }

  // Cannot deactivate yourself via PATCH either
  if (id === req.user.user_id && is_active === false) {
    return res.status(400).json(err('SELF_DEACTIVATION', 'You cannot deactivate your own account'));
  }

  // Validate role if provided
  if (role !== undefined && !VALID_ROLES.has(role)) {
    return res.status(400).json(err('VALIDATION_ERROR', "role must be 'admin' or 'staff'"));
  }

  // Build SET clause dynamically from supplied fields only
  const updates = [];
  const values = [];

  if (role !== undefined) {
    values.push(role);
    updates.push(`role = $${values.length}`);
  }

  if (is_active !== undefined) {
    values.push(is_active);
    updates.push(`is_active = $${values.length}`);
  }

  values.push(id);
  const whereClause = `$${values.length}`;

  try {
    const { rows } = await pool.query(
      `UPDATE app.users
       SET ${updates.join(', ')}
       WHERE id = ${whereClause}
       RETURNING id, google_email, display_name, role, is_active, created_at, last_login_at`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json(err('NOT_FOUND', 'User not found'));
    }

    return res.json({ user: rows[0] });
  } catch (e) {
    console.error('PATCH /admin/users/:id:', e);
    return res.status(500).json(err('INTERNAL_ERROR', 'Failed to update user'));
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id — soft delete (set is_active = false)
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  if (id === req.user.user_id) {
    return res.status(400).json(err('SELF_DEACTIVATION', 'You cannot deactivate your own account'));
  }

  try {
    const { rows } = await pool.query(
      `UPDATE app.users
       SET is_active = false
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json(err('NOT_FOUND', 'User not found'));
    }

    return res.json({ message: 'User deactivated' });
  } catch (e) {
    console.error('DELETE /admin/users/:id:', e);
    return res.status(500).json(err('INTERNAL_ERROR', 'Failed to deactivate user'));
  }
});

module.exports = router;
