// Role-based access control
// Usage: roleMiddleware('admin', 'vet')
const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated ❌'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')} ❌`,
        yourRole: req.user.role
      });
    }

    next();
  };
};

module.exports = roleMiddleware;