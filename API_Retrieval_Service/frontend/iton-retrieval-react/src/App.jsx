import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [userCity, setUserCity] = useState("")
  const [userState, setUserState] = useState("")
  const [maxQueries, setMaxQueries] = useState(null)
  const [maxUrls, setMaxUrls] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
  }
  return (
    <>
      <div>
        <h2>Pipeline request</h2>
        <form onSubmit={handleSubmit}>
          <input className="border-black outline-1 mx-10" placeholder="City" value={userCity} onChange={e => setUserCity(e.target.value)}/>
          <input className="border-black outline-1 mx-10" placeholder="State" value={userState} onChange={e => setUserState(e.target.value)}/>
          <input className="border-black outline-1 mx-10" placeholder="max queries" value={maxQueries} onChange={e => setMaxQueries(e.target.value)}/>
          <input className="border-black outline-1 mx-10" placeholder="max URLs" value={maxUrls} onChange={e => setMaxUrls(e.target.value)}/>
          <button type="submit">Submit</button>
        </form>
        
      </div>
    </>
  )
}

export default App
