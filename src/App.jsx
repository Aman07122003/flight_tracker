import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './page/Home'
const App = () => {
  return (
    <Router>
      <div className='m-0 p-0 h-[100vh] bg-black'>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App