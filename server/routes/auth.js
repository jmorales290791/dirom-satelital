/**
 * DIROM SATELITAL - Rutas de Autenticación
 */

const express = require('express');
const router = express.Router();
const { generateToken, authenticateToken } = require('../middleware/auth');

module.exports = function(db) {
  /**
   * POST /api/auth/login
   * Iniciar sesión
   */
  router.post('/login', (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
      }

      const user = db.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      if (!db.validatePassword(password, user.password)) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const token = generateToken(user);

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          company: user.company,
        }
      });
    } catch (err) {
      console.error('[AUTH] Error en login:', err.message);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  /**
   * GET /api/auth/me
   * Obtener perfil del usuario autenticado
   */
  router.get('/me', authenticateToken, (req, res) => {
    try {
      const user = db.getUserById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  /**
   * PUT /api/auth/password
   * Cambiar contraseña del usuario autenticado
   */
  router.put('/password', authenticateToken, (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
      }

      const user = db.getUserByUsername(req.user.username);
      if (!db.validatePassword(currentPassword, user.password)) {
        return res.status(401).json({ error: 'Contraseña actual incorrecta' });
      }

      db.updateUser(req.user.id, { password: newPassword });
      res.json({ message: 'Contraseña actualizada correctamente' });
    } catch (err) {
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return router;
};
