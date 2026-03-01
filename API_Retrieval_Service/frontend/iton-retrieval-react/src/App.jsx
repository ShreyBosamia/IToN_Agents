import { useState } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

function App() {
  const [count, setCount] = useState(0);
  const [userCity, setUserCity] = useState('');
  const [userState, setUserState] = useState('');
  const [maxQueries, setMaxQueries] = useState(null);
  const [maxUrls, setMaxUrls] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      city: userCity.trim(),
      state: userState.trim(),
      maxQueries: maxQueries === '' || maxQueries == null ? null : Number(maxQueries),
      maxUrls: maxUrls === '' || maxUrls == null ? null : Number(maxUrls),
    };

    try {
      const response = await fetch('http://localhost:4000/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Request failed');

      console.log('Stored pipeline id:', data.id);
    } catch (err) {
      console.error(err);
    }
  }
  return (
    <>
      <div>
        <h2>Pipeline request</h2>
        <form onSubmit={handleSubmit}>
          <input
            className="border-black outline-1 mx-10"
            placeholder="City"
            value={userCity}
            onChange={(e) => setUserCity(e.target.value)}
          />
          <input
            className="border-black outline-1 mx-10"
            placeholder="State"
            value={userState}
            onChange={(e) => setUserState(e.target.value)}
          />
          <input
            className="border-black outline-1 mx-10"
            placeholder="max queries"
            value={maxQueries}
            onChange={(e) => setMaxQueries(e.target.value)}
          />
          <input
            className="border-black outline-1 mx-10"
            placeholder="max URLs"
            value={maxUrls}
            onChange={(e) => setMaxUrls(e.target.value)}
          />
          <button type="submit">Submit</button>
        </form>
      </div>
    </>
  );
}

export default App;
