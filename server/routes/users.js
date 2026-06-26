/**
 * DIROM SATELITAL - Rutas de Gestión de Usuarios (Admin)
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

module.exports = function(db) {
  // Todas las rutas requieren autenticación y rol admin
  router.use(authenticateToken);
  router.use(requireAdmin);

  /**
   * GET /api/users
   * Listar todos los usuarios
   */
  router.get('/', (req, res) => {
    try {
      const users = db.getAllUsers();
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener usuarios' });
    }
  });

  /**
   * GET /api/users/:id
   * Obtener usuario por ID
   */
  router.get('/:id', (req, res) => {
    try {
      const user = db.getUserById(parseInt(req.params.id));
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener usuario' });
    }
  });

  /**
   * POST /api/users
   * Crear nuevo usuario
   */
  router.post('/', (req, res) => {
    try {
      const { username, password, name, email, phone, company, role } = req.body;

      if (!username || !password || !name) {
        return res.status(400).json({ error: 'Username, password y nombre son requeridos' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      }

      // Verificar que no exista el username
      const existing = db.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ error: 'El nombre de usuario ya existe' });
      }

      const userId = db.createUser({ username, password, name, email, phone, company, role });
      const user = db.getUserById(userId);
      res.status(201).json(user);
    } catch (err) {
      console.error('[USERS] Error al crear usuario:', err.message);
      res.status(500).json({ error: 'Error al crear usuario' });
    }
  });

  /**
   * PUT /api/users/:id
   * Actualizar usuario
   */
  router.put('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = db.getUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      db.updateUser(id, req.body);
      const updated = db.getUserById(id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar usuario' });
    }
  });

  /**
   * DELETE /api/users/:id
   * Desactivar usuario (soft delete)
   */
  router.delete('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (id === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
      }

      db.deleteUser(id);
      res.json({ message: 'Usuario desactivado correctamente' });
    } catch (err) {
      res.status(500).json({ error: 'Error al eliminar usuario' });
    }
  });

  return router;
};
