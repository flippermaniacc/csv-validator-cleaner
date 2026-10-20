import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { SchemaEditor } from './pages/SchemaEditor';
import { Schemas } from './pages/Schemas';

export function App() {
  return (
    <>
      <header className="app-header">
        <span className="brand">CSV Validator</span>
        <nav aria-label="Main">
          <NavLink to="/schemas">Schemas</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/schemas" replace />} />
          <Route path="/schemas" element={<Schemas />} />
          <Route path="/schemas/new" element={<SchemaEditor />} />
          <Route path="/schemas/:id" element={<SchemaEditor />} />
          <Route path="*" element={<p className="empty">Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
