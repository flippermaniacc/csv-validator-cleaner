import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { History } from './pages/History';
import { RunDetail } from './pages/RunDetail';
import { SchemaEditor } from './pages/SchemaEditor';
import { Schemas } from './pages/Schemas';
import { Validate } from './pages/Validate';

export function App() {
  return (
    <>
      <header className="app-header">
        <span className="brand">CSV Validator</span>
        <nav aria-label="Main">
          <NavLink to="/validate">Validate</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/schemas">Schemas</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/validate" replace />} />
          <Route path="/validate" element={<Validate />} />
          <Route path="/history" element={<History />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/schemas" element={<Schemas />} />
          <Route path="/schemas/new" element={<SchemaEditor />} />
          <Route path="/schemas/:id" element={<SchemaEditor />} />
          <Route path="*" element={<p className="empty">Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
