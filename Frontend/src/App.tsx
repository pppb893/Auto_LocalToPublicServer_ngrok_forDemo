import { useState, useEffect } from 'react'
import './App.css'
import DependencyCheck from './components/DependencyCheck'
import Dashboard from './components/Dashboard'

function App() {
  const [isReady, setIsReady] = useState<boolean | null>(null)

  useEffect(() => {
    checkDependencyStatus()
  }, [])

  const checkDependencyStatus = async () => {
    const passed = await window.electronAPI.getStoredData('dependencyCheckPassed')
    setIsReady(passed === true)
  }

  const handleDependencyCheckComplete = async () => {
    await window.electronAPI.setStoredData('dependencyCheckPassed', true)
    setIsReady(true)
  }

  if (isReady === null) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        color: '#fff',
        fontSize: '1.2rem'
      }}>
        Loading...
      </div>
    )
  }

  if (!isReady) {
    return <DependencyCheck onReady={handleDependencyCheckComplete} />
  }

  return <Dashboard />
}

export default App
