import React, { memo, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditApp } from '../../app/static/js/edit/app.js';
import { createAssembleApp } from '../../app/static/js/assemble/app.js';
import { editMarkup, assembleMarkup } from './generated/workspaces.js';
import { createLocalEngine } from './engine.js';
import { createLocalApi, createPlanStorage, createSourceStore } from './storage.js';
import './style.css';

const mode = new URLSearchParams(location.search).get('view') === 'assemble' ? 'assemble' : 'edit';
const desktop = location.protocol === 'apdf:';
const base = new URL('./', document.baseURI);
const asset = path => new URL(path, base).href;

// Existing controllers own this DOM island. React owns the application shell.
const Workspace = memo(function Workspace({ engine, onError }) {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      if (mode === 'edit') {
        createEditApp({
          applyEdits: engine.edit,
          previewOptions: {
            pdfJsUrl: asset('vendor/pdfjs/pdf.mjs'), workerUrl: asset('vendor/pdfjs/pdf.worker.mjs'),
            documentOptions: {
              cMapUrl: asset('vendor/pdfjs/cmaps/'), cMapPacked: true,
              standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/'), wasmUrl: asset('vendor/pdfjs/wasm/'),
              isEvalSupported: false,
            },
          },
        }).init();
      } else {
        createAssembleApp({
          local: true, clientId: 'local',
          apiJson: createLocalApi(createSourceStore(engine), engine),
          sourceOrderStorage: createPlanStorage(),
        }).init().catch(onError);
      }
    } catch (error) { onError(error); }
  }, [engine, onError]);
  return <div dangerouslySetInnerHTML={{ __html: mode === 'edit' ? editMarkup : assembleMarkup }} />;
});

function App() {
  const [message, setMessage] = useState('Starting the local workspace…');
  const [engine, setEngine] = useState(null);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(desktop ? 'Offline desktop app · Everything is included' : 'Preparing offline access…');
  const [install, setInstall] = useState(null);
  useEffect(() => {
    const local = createLocalEngine(setMessage);
    local.ready.then(() => setEngine(local)).catch(error => setError(error.message));
    return () => local.destroy();
  }, []);
  useEffect(() => {
    if (desktop) return;
    const prompt = event => { event.preventDefault(); setInstall(event); };
    window.addEventListener('beforeinstallprompt', prompt);
    const installed = () => setInstall(null);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(asset('sw.js'), { scope: base.pathname }).then(async () => {
        await navigator.serviceWorker.ready;
        setOffline('Ready for offline use');
      }).catch(() => setOffline('Offline cache unavailable. Keep the local server running.'));
    } else setOffline(import.meta.env.DEV ? 'Development preview' : 'Keep the local server running');
    return () => {
      window.removeEventListener('beforeinstallprompt', prompt);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return <main>
    <header className="hero local-header">
      <div className="local-brand">
        <img src={asset('app-icon.svg')} alt="" width="48" height="48" />
        <div><h1>APDF <span>Local</span></h1><p>Your PDFs. Your device.</p></div>
      </div>
      <div className="local-actions">
        <span className="privacy-badge"><span aria-hidden="true">●</span> Files stay on this device</span>
        {install && <button onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>Install app</button>}
      </div>
    </header>
    <nav className="main-tabs" aria-label="Workspace">
      <a className={`main-tab ${mode === 'assemble' ? 'active' : ''}`} href="?view=assemble" aria-current={mode === 'assemble' ? 'page' : undefined}>Assemble</a>
      <a className={`main-tab ${mode === 'edit' ? 'active' : ''}`} href="?view=edit" aria-current={mode === 'edit' ? 'page' : undefined}>Edit</a>
    </nav>
    {error ? <section className="card local-startup" role="alert"><h2>Unable to start the workspace</h2><p>{error.message || String(error)}</p><button onClick={() => location.reload()}>Retry</button></section>
      : engine ? <Workspace engine={engine} onError={setError} />
      : <section className="card local-startup" role="status"><span className="local-spinner" aria-hidden="true" /><h2>Preparing your workspace</h2><p>{message}</p><p className="small">The first launch may take a moment. PDF processing runs on this device.</p></section>}
    <footer className="site-footer local-footer">
      <span className="offline-status" role="status">{offline}</span>
      <span>No account · No PDF uploads · <a href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Open source licenses</a></span>
    </footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
