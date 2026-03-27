require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
 
const app  = express();
const PORT = process.env.PORT || 5000;
 
// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'https://djibouti-fashion.great-site.net/' }));
app.use(express.json());
 
// ── Pool MySQL ────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'centerbeam.proxy.rlwy.net',
  port:     process.env.DB_PORT     || 50959,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'uvLhdCwsxDMnYvkWlkDQErQmLNynzJaZ',
  database: process.env.DB_NAME     || 'railway',
  waitForConnections: true,
  connectionLimit:    10
});
 
// ── Auth Middleware ───────────────────────────────────────────────────────────
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
};
 
// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES AUTH
// ══════════════════════════════════════════════════════════════════════════════
 
// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { nom, email, mot_de_passe, telephone } = req.body;
    if (!nom || !email || !mot_de_passe)
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
 
    const [exist] = await pool.query(
      'SELECT id FROM clients WHERE email = ?', [email]
    );
    if (exist.length > 0)
      return res.status(400).json({ error: 'Email déjà utilisé' });
 
    const hash = await bcrypt.hash(mot_de_passe, 10);
    const [result] = await pool.query(
      'INSERT INTO clients (nom, email, mot_de_passe, telephone) VALUES (?, ?, ?, ?)',
      [nom, email, hash, telephone || null]
    );
 
    const token = jwt.sign(
      { id: result.insertId, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
 
    res.status(201).json({
      token,
      client: { id: result.insertId, nom, email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
 
// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    const [rows] = await pool.query(
      'SELECT * FROM clients WHERE email = ?', [email]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
 
    const client = rows[0];
    const valid  = await bcrypt.compare(mot_de_passe, client.mot_de_passe);
    if (!valid)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
 
    const token = jwt.sign(
      { id: client.id, email: client.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
 
    res.json({
      token,
      client: { id: client.id, nom: client.nom, email: client.email }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
 
// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES PRODUITS
// ══════════════════════════════════════════════════════════════════════════════
 
// GET /api/produits
app.get('/api/produits', async (req, res) => {
  try {
    const { categorie, search, featured } = req.query;
    let sql = `SELECT p.*, c.nom AS categorie_nom
               FROM produits p
               LEFT JOIN categories c ON p.categorie_id = c.id
               WHERE 1=1`;
    const params = [];
 
    if (categorie) { sql += ' AND p.categorie_id = ?'; params.push(categorie); }
    if (search)    { sql += ' AND p.nom LIKE ?';        params.push(`%${search}%`); }
    if (featured)  { sql += ' AND p.featured = TRUE'; }
    sql += ' ORDER BY p.created_at DESC';
 
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// GET /api/produits/:id
app.get('/api/produits/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, c.nom AS categorie_nom FROM produits p
       LEFT JOIN categories c ON p.categorie_id = c.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES CATEGORIES
// ══════════════════════════════════════════════════════════════════════════════
 
app.get('/api/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories ORDER BY nom');
  res.json(rows);
});
 
// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES PANIER (auth requise)
// ══════════════════════════════════════════════════════════════════════════════
 
// GET /api/panier
app.get('/api/panier', auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pa.*, p.nom, p.prix, p.prix_promo, p.image, p.stock
     FROM paniers pa
     JOIN produits p ON pa.produit_id = p.id
     WHERE pa.client_id = ?`,
    [req.user.id]
  );
  res.json(rows);
});
 
// POST /api/panier
app.post('/api/panier', auth, async (req, res) => {
  try {
    const { produit_id, quantite = 1, taille_choisie } = req.body;
    const [exist] = await pool.query(
      'SELECT id, quantite FROM paniers WHERE client_id = ? AND produit_id = ?',
      [req.user.id, produit_id]
    );
    if (exist.length > 0) {
      await pool.query(
        'UPDATE paniers SET quantite = quantite + ? WHERE id = ?',
        [quantite, exist[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO paniers (client_id, produit_id, quantite, taille_choisie) VALUES (?,?,?,?)',
        [req.user.id, produit_id, quantite, taille_choisie]
      );
    }
    res.json({ message: 'Produit ajouté au panier' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// PUT /api/panier/:id
app.put('/api/panier/:id', auth, async (req, res) => {
  const { quantite } = req.body;
  if (quantite <= 0) {
    await pool.query('DELETE FROM paniers WHERE id = ? AND client_id = ?',
      [req.params.id, req.user.id]);
  } else {
    await pool.query('UPDATE paniers SET quantite = ? WHERE id = ? AND client_id = ?',
      [quantite, req.params.id, req.user.id]);
  }
  res.json({ message: 'Panier mis à jour' });
});
 
// DELETE /api/panier/:id
app.delete('/api/panier/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM paniers WHERE id = ? AND client_id = ?',
    [req.params.id, req.user.id]);
  res.json({ message: 'Produit retiré' });
});
 
// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES COMMANDES (auth requise)
// ══════════════════════════════════════════════════════════════════════════════
 
// POST /api/commandes
app.post('/api/commandes', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
 
    const { adresse_livraison, mode_paiement } = req.body;
 
    // Récupérer le panier
    const [items] = await conn.query(
      `SELECT pa.*, p.prix, p.prix_promo, p.stock
       FROM paniers pa JOIN produits p ON pa.produit_id = p.id
       WHERE pa.client_id = ?`,
      [req.user.id]
    );
    if (items.length === 0) throw new Error('Panier vide');
 
    const total = items.reduce((s, i) =>
      s + (i.prix_promo || i.prix) * i.quantite, 0);
 
    // Créer la commande
    const [cmd] = await conn.query(
      `INSERT INTO commandes
       (client_id, montant_total, adresse_livraison, mode_paiement, statut_paiement)
       VALUES (?, ?, ?, ?, 'paye')`,
      [req.user.id, total, adresse_livraison, mode_paiement]
    );
 
    // Créer les items et décrémenter le stock
    for (const item of items) {
      await conn.query(
        'INSERT INTO commande_items (commande_id,produit_id,quantite,prix_unitaire,taille) VALUES (?,?,?,?,?)',
        [cmd.insertId, item.produit_id, item.quantite, item.prix_promo || item.prix, item.taille_choisie]
      );
      await conn.query(
        'UPDATE produits SET stock = stock - ? WHERE id = ?',
        [item.quantite, item.produit_id]
      );
    }
 
    // Vider le panier
    await conn.query('DELETE FROM paniers WHERE client_id = ?', [req.user.id]);
    await conn.commit();
 
    res.json({ message: 'Commande créée avec succès', commande_id: cmd.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});
 
// GET /api/commandes
app.get('/api/commandes', auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*,
       GROUP_CONCAT(p.nom SEPARATOR ', ') AS produits_noms
     FROM commandes c
     LEFT JOIN commande_items ci ON c.id = ci.commande_id
     LEFT JOIN produits p ON ci.produit_id = p.id
     WHERE c.client_id = ?
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});
 
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré : http://localhost:${PORT}`);
  console.log(`📦 Base de données  : ${process.env.DB_NAME}@${process.env.DB_HOST}`);
});
