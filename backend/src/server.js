import express from 'express';
import pg from 'pg';

const app = express();
const pool = new pg.Pool();

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/db-health', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS user'
    );
    res.json({ status: 'ok', ...result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error' });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on ${port}`);
});