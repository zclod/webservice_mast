const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-change-in-production';

app.use(express.json());

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const result = await pool.query('SELECT count FROM visits WHERE id = 1');
  if (result.rows.length === 0) {
    await pool.query('INSERT INTO visits (id, count) VALUES (1, 0)');
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token richiesto' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token non valido' });
    req.user = user;
    next();
  });
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username e password richiesti' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
    res.status(201).json({ message: 'Utente registrato con successo' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username già esistente' });
    }
    console.error(err);
    res.status(500).json({ error: 'Errore durante la registrazione' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username e password richiesti' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore durante il login' });
  }
});

app.get('/api/profile', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>MAST Webservice</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .container { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
    button { padding: 10px 20px; margin: 5px; cursor: pointer; }
    .hidden { display: none; }
    .error { color: red; }
    .success { color: green; }
    #visitCounter { font-size: 24px; text-align: center; }
  </style>
</head>
<body>
  <h1>Benvenuto nel webservice MAST!</h1>
  
  <div id="authSection">
    <div class="container">
      <h2>Login</h2>
      <input type="text" id="loginUsername" placeholder="Username">
      <input type="password" id="loginPassword" placeholder="Password">
      <button onclick="login()">Login</button>
    </div>
    
    <div class="container">
      <h2>Registrati</h2>
      <input type="text" id="registerUsername" placeholder="Username">
      <input type="password" id="registerPassword" placeholder="Password">
      <button onclick="register()">Registrati</button>
    </div>
  </div>
  
  <div id="userSection" class="hidden">
    <div class="container">
      <p>Benvenuto, <strong id="username"></strong>!</p>
      <button onclick="logout()">Logout</button>
    </div>
    
    <div class="container">
      <h2>Contatore Visite</h2>
      <div id="visitCounter">Caricamento...</div>
    </div>
  </div>
  
  <p id="message"></p>

  <script>
    let token = localStorage.getItem('token');
    
    function showMessage(text, isError = false) {
      const msg = document.getElementById('message');
      msg.textContent = text;
      msg.className = isError ? 'error' : 'success';
    }
    
    async function checkAuth() {
      if (!token) return false;
      try {
        const res = await fetch('/api/profile', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('username').textContent = data.user.username;
          return true;
        }
      } catch (e) {}
      localStorage.removeItem('token');
      token = null;
      return false;
    }
    
    async function loadVisits() {
      try {
        const res = await fetch('/api/visits', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('visitCounter').textContent = 'Visite totali: ' + data.visits;
        } else {
          document.getElementById('visitCounter').textContent = 'Errore caricamento';
        }
      } catch (e) {
        document.getElementById('visitCounter').textContent = 'Errore caricamento';
      }
    }
    
    async function login() {
      const username = document.getElementById('loginUsername').value;
      const password = document.getElementById('loginPassword').value;
      
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (res.ok) {
          token = data.token;
          localStorage.setItem('token', token);
          showMessage('Login effettuato!');
          showUserSection();
        } else {
          showMessage(data.error, true);
        }
      } catch (e) {
        showMessage('Errore di connessione', true);
      }
    }
    
    async function register() {
      const username = document.getElementById('registerUsername').value;
      const password = document.getElementById('registerPassword').value;
      
      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (res.ok) {
          showMessage('Registrazione completata! Ora fai il login.');
        } else {
          showMessage(data.error, true);
        }
      } catch (e) {
        showMessage('Errore di connessione', true);
      }
    }
    
    function logout() {
      localStorage.removeItem('token');
      token = null;
      showAuthSection();
      showMessage('Logout effettuato');
    }
    
    function showUserSection() {
      document.getElementById('authSection').classList.add('hidden');
      document.getElementById('userSection').classList.remove('hidden');
      loadVisits();
    }
    
    function showAuthSection() {
      document.getElementById('authSection').classList.remove('hidden');
      document.getElementById('userSection').classList.add('hidden');
    }
    
    checkAuth().then(auth => {
      if (auth) showUserSection();
    });
  </script>
</body>
</html>
  `);
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/visits', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE visits SET count = count + 1 WHERE id = 1');
    const result = await pool.query('SELECT count FROM visits WHERE id = 1');
    res.json({ visits: result.rows[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del database' });
  }
});

app.put('/api/visits', authenticateToken, async (req, res) => {
  try {
    const { count } = req.body;
    if (typeof count !== 'number' || count < 0) {
      return res.status(400).json({ error: 'Il valore deve essere un numero positivo' });
    }
    await pool.query('UPDATE visits SET count = $1 WHERE id = 1', [count]);
    res.json({ visits: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del database' });
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log('Server in esecuzione sulla porta ' + PORT);
  });
}).catch(err => {
  console.error('Errore inizializzazione DB:', err);
  process.exit(1);
});
