const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add showLoginOptions state
if (!content.includes('const [showLoginOptions, setShowLoginOptions]')) {
  content = content.replace(
    'const [aiOpen, setAiOpen] = useState(false);',
    'const [aiOpen, setAiOpen] = useState(false);\n  const [showLoginOptions, setShowLoginOptions] = useState(false);'
  );
}

// 2. Replace the login block
const oldLoginBlock = `<div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ marginBottom: '10px' }}>Usuarios</h3>
          {TEAM.map(member => {
            const hasNotif = userNotifications[member]?.length > 0;
            const hasSwap = pendingSwaps.some(s => s.toUser === member);
            return (
              <button key={member} className="btn btn-outline" onClick={() => handleLogin(member, "USER")} style={{ position: 'relative' }}>
                Ingresar como {member}
                {(hasNotif || hasSwap) && (
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', backgroundColor: hasSwap ? '#2e7d32' : '#ef6c00', width: '12px', height: '12px', borderRadius: '50%' }}></span>
                )}
              </button>
            );
          })}
          
          <h3 style={{ marginTop: '2rem', marginBottom: '10px' }}>Administrador</h3>
          <button className="btn btn-primary" onClick={() => handleLogin("Admin", "ADMIN")}>
            Ingresar como Administrador
          </button>
        </div>`;

const newLoginBlock = `<div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {!showLoginOptions ? (
            <button 
              className="btn btn-primary" 
              onClick={() => setShowLoginOptions(true)}
              style={{ padding: '16px', fontSize: '1.2rem', fontWeight: 'bold' }}
            >
              Iniciar Sesión
            </button>
          ) : (
            <>
              <h3 style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Usuarios
                <button onClick={() => setShowLoginOptions(false)} style={{ background: 'transparent', border: 'none', color: 'var(--glass-text)', cursor: 'pointer', fontSize: '0.9rem' }}>✖ Cerrar</button>
              </h3>
              {TEAM.map(member => {
                const hasNotif = userNotifications[member]?.length > 0;
                const hasSwap = pendingSwaps.some(s => s.toUser === member);
                return (
                  <button key={member} className="btn btn-outline" onClick={() => handleLogin(member, "USER")} style={{ position: 'relative' }}>
                    Ingresar como {member}
                    {(hasNotif || hasSwap) && (
                      <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', backgroundColor: hasSwap ? '#2e7d32' : '#ef6c00', width: '12px', height: '12px', borderRadius: '50%' }}></span>
                    )}
                  </button>
                );
              })}
              
              <h3 style={{ marginTop: '2rem', marginBottom: '10px' }}>Administrador</h3>
              <button className="btn btn-primary" onClick={() => handleLogin("Admin", "ADMIN")}>
                Ingresar como Administrador
              </button>
            </>
          )}
        </div>`;

content = content.replace(oldLoginBlock, newLoginBlock);

fs.writeFileSync(file, content);
console.log('Login block patched successfully.');
