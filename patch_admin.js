const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Wrap Activity Log in <details>
if (!content.includes('<details style={{ marginBottom: "1rem" }}>')) {
  content = content.replace(
    "<h3 style={{ borderBottom: '2px solid var(--glass-border)', paddingBottom: '8px', marginBottom: '16px' }}>Registro de Actividad</h3>",
    `<details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold', paddingBottom: '8px', borderBottom: '2px solid var(--glass-border)', marginBottom: '16px' }}>
            Historial de Cambios (Clic para expandir)
          </summary>`
  );
  
  content = content.replace(
    `          </div>\n        )}\n      </div>`,
    `          </div>\n        )}\n        </details>\n      </div>`
  );
}

// 2. Add AI Admin State to AdminView
if (!content.includes('const [aiAdminPrompt, setAiAdminPrompt]')) {
  const adminStateTarget = `const [newsFile, setNewsFile] = useState<File | null>(null);`;
  const adminStateInject = `const [newsFile, setNewsFile] = useState<File | null>(null);

  const [aiAdminPrompt, setAiAdminPrompt] = useState("");
  const [aiAdminLoading, setAiAdminLoading] = useState(false);
  const [aiAdminResult, setAiAdminResult] = useState<any>(null);

  const handleAdminAI = async () => {
    if (!aiAdminPrompt.trim()) return;
    setAiAdminLoading(true);
    setAiAdminResult(null);
    try {
      const res = await fetch('/api/ai_admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiAdminPrompt })
      });
      const data = await res.json();
      if (data.response) {
        setAiAdminResult(JSON.parse(data.response));
      } else {
        alert("Error de la IA: " + data.error);
      }
    } catch (e: any) {
      alert("Error en AI Admin: " + e.message);
    } finally {
      setAiAdminLoading(false);
    }
  };

  const handlePublishGrid = async () => {
    if (!aiAdminResult) return;
    try {
      await addDoc(collection(db, "announcements"), {
        text: "Nuevo cronograma publicado",
        type: "schedule_grid",
        gridData: aiAdminResult,
        timestamp: serverTimestamp(),
        author: "Administrador (IA)"
      });
      alert("Cronograma publicado con éxito en Novedades.");
      setAiAdminResult(null);
      setAiAdminPrompt("");
    } catch (e: any) {
      alert("Error al publicar cronograma: " + e.message);
    }
  };`;
  content = content.replace(adminStateTarget, adminStateInject);
}

// 3. Inject AI Admin UI into AdminView (before Novedades form)
if (!content.includes('⭐ Organizar Cronograma con IA')) {
  const adminUITarget = `<div style={{ marginBottom: '2rem' }}>\n            <h3 style={{ color: '#03a9f4', borderBottom: '2px solid #03a9f4', paddingBottom: '8px', marginBottom: '16px' }}>\n              📢 Publicar Novedad`;
  const adminUIInject = `<div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#9c27b0', borderBottom: '2px solid #9c27b0', paddingBottom: '8px', marginBottom: '16px' }}>
              🤖 Organizar Cronograma con IA
            </h3>
            <div className="glass-card" style={{ padding: '16px', border: '1px solid rgba(156, 39, 176, 0.5)' }}>
              <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>Pídele a la IA que arme la grilla mensual indicando las reglas específicas (ej: "Armame los turnos de Agosto. Santi solo sábados a la tarde").</p>
              <textarea 
                value={aiAdminPrompt}
                onChange={(e) => setAiAdminPrompt(e.target.value)}
                placeholder="Escribe tu instrucción aquí..."
                rows={3}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', marginBottom: '12px', resize: 'vertical' }}
              />
              <button 
                className="btn btn-primary"
                onClick={handleAdminAI}
                disabled={aiAdminLoading}
                style={{ width: '100%', backgroundColor: '#9c27b0' }}
              >
                {aiAdminLoading ? "Pensando y Generando Grilla..." : "Generar Cronograma"}
              </button>

              {aiAdminResult && (
                <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                  <h4 style={{ textAlign: 'center', marginBottom: '16px', color: '#fff' }}>{aiAdminResult.title}</h4>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>
                      <div>Fecha</div>
                      <div>Proyección (Mañana)</div>
                      <div>Culto Tarde (Equipo)</div>
                    </div>
                    {aiAdminResult.rows.map((row: any, i: number) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: '0.95rem' }}>
                        <div style={{ fontWeight: 'bold' }}>{row.date}</div>
                        <div>{row.morning}</div>
                        <div>{row.afternoon}</div>
                      </div>
                    ))}
                  </div>

                  <button 
                    className="btn btn-primary"
                    onClick={handlePublishGrid}
                    style={{ width: '100%', backgroundColor: '#4caf50', marginTop: '16px' }}
                  >
                    Aprobar y Publicar en Novedades
                  </button>
                </div>
              )}
            </div>
          </div>\n\n          ` + adminUITarget;
  content = content.replace(adminUITarget, adminUIInject);
}

// 4. Update Announcement rendering in UserView and AdminView
// Instead of replacing blindly, we can create a renderAnnouncement function or just replace the mapping logic.
// We will search for `{a.text}` inside the announcements map and replace the card content to handle `schedule_grid`.
const mapTarget = `{a.text}\n                  </div>\n                  {a.fileUrl && (\n                    <div style={{ marginTop: '12px' }}>`;
const mapInject = `{a.type === 'schedule_grid' && a.gridData ? (
                    <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <h4 style={{ textAlign: 'center', marginBottom: '16px', color: '#fff' }}>{a.gridData.title}</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>
                          <div>Fecha</div>
                          <div>Mañana</div>
                          <div>Tarde</div>
                        </div>
                        {a.gridData.rows.map((row: any, i: number) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: '0.9rem' }}>
                            <div style={{ fontWeight: 'bold' }}>{row.date}</div>
                            <div>{row.morning}</div>
                            <div>{row.afternoon}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '1rem', marginBottom: '8px' }}>
                      {a.text}
                    </div>
                  )}
                  {a.fileUrl && (
                    <div style={{ marginTop: '12px' }}>`;
                    
// Because it appears in two places (UserView and AdminView), we can replace all occurrences.
// Note: The original structure was:
// <div style={{ whiteSpace: 'pre-wrap', fontSize: '1rem', marginBottom: '8px' }}>
//   {a.text}
// </div>
// {a.fileUrl && (
const targetPattern = /<div style={{ whiteSpace: 'pre-wrap', fontSize: '1rem', marginBottom: '8px' }}>[\s\S]*?\{a\.text\}[\s\S]*?<\/div>[\s\S]*?\{a\.fileUrl && \(/g;

content = content.replace(targetPattern, mapInject);

fs.writeFileSync(file, content);
console.log('Patched page.tsx successfully!');
