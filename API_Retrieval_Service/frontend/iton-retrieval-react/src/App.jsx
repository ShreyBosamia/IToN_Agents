import { useState } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

function App() {
  const [count, setCount] = useState(0);
  const [userCity, setUserCity] = useState('');
  const [userState, setUserState] = useState('');
  const [userCategory, setUserCategory] = useState('');
  const [maxQueries, setMaxQueries] = useState(null);
  const [maxUrls, setMaxUrls] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      city: userCity.trim(),
      state: userState.trim(),
      category: userCategory.trim(),
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
      <div className="max-w-md mx-auto px-6 flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Pipeline request</h1>
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-4">
              <input  
                className="w-full text-sm rounded-lg focus:border-blue-500 focus:ring-2 px-4 py-2  border border-gray-300 outline-1"
                placeholder="City"
                value={userCity}
                onChange={(e) => setUserCity(e.target.value)}
              />
              <input
                className="w-full text-sm rounded-lg focus:border-blue-500 focus:ring-2 px-4 py-2  border border-gray-300 outline-1"
                placeholder="State"
                value={userState}
                onChange={(e) => setUserState(e.target.value)}
              />
              <input
                className="w-full text-sm rounded-lg focus:border-blue-500 focus:ring-2 px-4 py-2  border border-gray-300 outline-1"
                placeholder="Category"
                value={userCategory}
                onChange={(e) => setUserCategory(e.target.value)}
              />
              <input
                className="w-full text-sm rounded-lg focus:border-blue-500 focus:ring-2 px-4 py-2 border border-gray-300 outline-1"
                placeholder="Max queries"
                value={maxQueries}
                onChange={(e) => setMaxQueries(e.target.value)}
              />
              <input
                className="w-full text-sm rounded-lg focus:border-blue-500 focus:ring-2 px-4 py-2 border border-gray-300 outline-1"
                placeholder="Max URLs"
                value={maxUrls}
                onChange={(e) => setMaxUrls(e.target.value)}
              />
              <button className="w-full cursor-pointer bg-[#97BD82] text-center rounded-lg focus:border-blue-500 focus:ring-2 px-4 py-2 border border-gray-300 outline-1" type="submit">Submit</button>
            </div>

          </form>
        </div>
    </>
  );
}

export default App;
