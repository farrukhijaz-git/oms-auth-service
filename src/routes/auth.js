const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const requireJwt = require('../middleware/requireJwt');

const router = express.Router();

const REFRESH_COOKIE = 'oms_refresh';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours in ms
};

function issueAccessToken(user) {
  return jwt.sign(
    { user_id: user.id, email: user.google_email, role: user.role },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

function issueRefreshToken(user) {
  return jwt.sign(
    { user_id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { algorithm: 'HS256', expiresIn: '8h' }
  );
}

// ---------------------------------------------------------------------------
// 1. GET /auth/google — redirect to Google consent screen
// ---------------------------------------------------------------------------
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// ---------------------------------------------------------------------------
// 2. GET /auth/google/callback — receive Google profile, gate on app.users
// ---------------------------------------------------------------------------
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/auth/error?reason=oauth_failed`, session: false }),
  async (req, res) => {
    const frontendError = `${process.env.FRONTEND_URL}/auth/error?reason=not_approved`;

    try {
      const { rows } = await pool.query(
        `SELECT id, google_email, display_name, role, is_active
         FROM app.users
         WHERE google_email = $1 AND is_active = true`,
        [req.user.email]
      );

      if (rows.length === 0) {
        return res.redirect(frontendError);
      }

      const user = rows[0];

      // Update last login timestamp
      await pool.query(
        'UPDATE app.users SET last_login_at = now() WHERE id = $1',
        [user.id]
      );

      const accessToken = issueAccessToken(user);
      const refreshToken = issueRefreshToken(user);

      res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
      return res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${accessToken}`);
    } catch (err) {
      console.error('OAuth callback error:', err);
      return res.redirect(frontendError);
    }
  }
);

// ---------------------------------------------------------------------------
// 3. POST /auth/refresh — verify refresh cookie, issue new access token
// ---------------------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  const token = req.cookies[REFRESH_COOKIE];

  if (!token) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, google_email, display_name, role
       FROM app.users
       WHERE id = $1 AND is_active = true`,
      [payload.user_id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = rows[0];
    const accessToken = issueAccessToken(user);

    return res.json({
      token: accessToken,
      user: {
        id: user.id,
        email: user.google_email,
        role: user.role,
        display_name: user.display_name,
      },
    });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// 4. POST /auth/logout — clear refresh cookie
// ---------------------------------------------------------------------------
router.post('/logout', requireJwt, (req, res) => {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: cookieOptions.httpOnly,
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
  });
  return res.status(200).json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// 5. GET /auth/me — return full user record for current JWT
// ---------------------------------------------------------------------------
router.get('/me', requireJwt, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, google_email, display_name, role, last_login_at
       FROM app.users
       WHERE id = $1 AND is_active = true`,
      [req.user.user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    return res.json({
      id: user.id,
      email: user.google_email,
      role: user.role,
      display_name: user.display_name,
      last_login_at: user.last_login_at,
    });
  } catch (err) {
    console.error('GET /me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
