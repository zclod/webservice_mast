const express = require('express');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      count INTEGER DEFAULT 0
    )
  `);
  const result = await pool.query('SELECT count FROM visits WHERE id = 1');
  if (result.rows.length === 0) {
    await pool.query('INSERT INTO visits (id, count) VALUES (1, 0)');
  }
}

app.get('/', async (req, res) => {
  try {
    await pool.query('UPDATE visits SET count = count + 1 WHERE id = 1');
    const result = await pool.query('SELECT count FROM visits WHERE id = 1');
    const count = result.rows[0].count;
    res.send(`
      <h1>Benvenuto nel webservice MAST!</h1>
      <p>Visite totali: <strong>${count}</strong></p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore del database');
  }
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/visits', async (req, res) => {
  try {
    const result = await pool.query('SELECT count FROM visits WHERE id = 1');
    res.json({ visits: result.rows[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del database' });
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server in esecuzione sulla porta ${PORT}`);
  });
}).catch(err => {
  console.error('Errore inizializzazione DB:', err);
  process.exit(1);
});
