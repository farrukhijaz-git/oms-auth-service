// requireJwt must run before this middleware — it sets req.user from the JWT payload.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }

  next();
}

module.exports = requireAdmin;
