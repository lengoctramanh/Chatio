import { useEffect, useState } from 'react';

export default function App() {
  const [result, setResult] = useState('Đang kết nối...');

  useEffect(() => {
    fetch('/api/db-health')
      .then((response) => response.json())
      .then((data) => setResult(JSON.stringify(data, null, 2)))
      .catch(() => setResult('Không kết nối được backend'));
  }, []);

  return (
    <main style={{ padding: 32 }}>
      <h1>Chatio</h1>
      <pre>{result}</pre>
    </main>
  );
}