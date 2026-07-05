const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add Unavailability import if missing (it might be exported from rotation.ts)
if (!content.includes('Unavailability')) {
  content = content.replace(
    'import { TEAM, getScheduleForDate, formatDate, getAllFutureShiftsForUser, ApprovedSwap } from "@/lib/rotation";',
    'import { TEAM, getScheduleForDate, formatDate, getAllFutureShiftsForUser, ApprovedSwap, Unavailability } from "@/lib/rotation";'
  );
}

// 2. Add unavailabilities state
if (!content.includes('const [unavailabilities, setUnavailabilities]')) {
  content = content.replace(
    'const [instagramProfileUrl, setInstagramProfileUrl] = useState<string>("");',
    'const [instagramProfileUrl, setInstagramProfileUrl] = useState<string>("");\n  const [unavailabilities, setUnavailabilities] = useState<Unavailability[]>([]);'
  );
}

// 3. Update global listener & init
content = content.replace(
  'if (data.instagramProfileUrl !== undefined) setInstagramProfileUrl(data.instagramProfileUrl);',
  'if (data.instagramProfileUrl !== undefined) setInstagramProfileUrl(data.instagramProfileUrl);\n        if (data.unavailabilities !== undefined) setUnavailabilities(data.unavailabilities);'
);

content = content.replace(
  'seedOffset: 0,',
  'seedOffset: 0,\n          unavailabilities: [],'
);

content = content.replace(
  'getScheduleForDate(new Date(), [], 0)',
  'getScheduleForDate(new Date(), [], 0, [])'
);

// Update main getScheduleForDate call inside useEffect
content = content.replace(
  'const sched = getScheduleForDate(new Date(), approvedSwaps, data.seedOffset || 0);',
  'const sched = getScheduleForDate(new Date(), approvedSwaps, data.seedOffset || 0, data.unavailabilities || []);'
);


// 4. Update UserView definition and usages
content = content.replace(
  'specialShifts: SpecialShift[], seedOffset: number, announcements: Announcement[], instagramPostUrl: string, instagramProfileUrl: string, onConfirm:',
  'specialShifts: SpecialShift[], seedOffset: number, announcements: Announcement[], instagramPostUrl: string, instagramProfileUrl: string, unavailabilities: Unavailability[], onConfirm:'
);

content = content.replace(
  'const futureShifts = getAllFutureShiftsForUser(userName, searchFrom, 5, approvedSwaps, seedOffset);',
  'const futureShifts = getAllFutureShiftsForUser(userName, searchFrom, 5, approvedSwaps, seedOffset, unavailabilities);'
);

content = content.replace(
  'getAllFutureShiftsForUser(member, searchFrom, 5, approvedSwaps, seedOffset);',
  'getAllFutureShiftsForUser(member, searchFrom, 5, approvedSwaps, seedOffset, unavailabilities);'
);

content = content.replace(
  '<UserView \n            instagramPostUrl={instagramPostUrl}\n            instagramProfileUrl={instagramProfileUrl}\n            specialShifts={specialShifts}',
  '<UserView \n            unavailabilities={unavailabilities}\n            instagramPostUrl={instagramPostUrl}\n            instagramProfileUrl={instagramProfileUrl}\n            specialShifts={specialShifts}'
);

// 5. Add Bible Button in UserView (just above Novedades)
const bibleBtn = `      {/* Bible Button */}
      <div style={{ marginBottom: '1.5rem' }}>
        <a 
          href="https://www.bible.com/es/bible/149/GEN.1.RVR1960"
          target="_blank" rel="noopener noreferrer"
          className="btn"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3f51b5', color: 'white', border: 'none', fontWeight: 'bold', padding: '16px', borderRadius: '12px', fontSize: '1.1rem', boxShadow: '0 4px 12px rgba(63, 81, 181, 0.4)' }}
        >
          📖 Abrir Biblia (RVR1960)
        </a>
      </div>

      {/* Sección de Novedades */}`;

content = content.replace('{/* Sección de Novedades */}', bibleBtn);

// 6. Update AdminView definition and usages
content = content.replace(
  'instagramPostUrl?: string, instagramProfileUrl?: string, onUpdateInstagramInfo?: (postUrl: string, profileUrl: string) => void',
  'instagramPostUrl?: string, instagramProfileUrl?: string, onUpdateInstagramInfo?: (postUrl: string, profileUrl: string) => void, unavailabilities?: Unavailability[], onAddUnavailability?: (date: string, user: string) => void, onRemoveUnavailability?: (date: string, user: string) => void'
);

content = content.replace(
  'onUpdateInstagramInfo={async (post, profile) => {',
  `unavailabilities={unavailabilities}
            onAddUnavailability={async (date, user) => {
              const newU = [...unavailabilities, { date, user }];
              await setDoc(doc(db, "app_state", "global"), { unavailabilities: newU }, { merge: true });
            }}
            onRemoveUnavailability={async (date, user) => {
              const newU = unavailabilities.filter(u => !(u.date === date && u.user === user));
              await setDoc(doc(db, "app_state", "global"), { unavailabilities: newU }, { merge: true });
            }}
            onUpdateInstagramInfo={async (post, profile) => {`
);

// 7. Add Admin UI for Unavailabilities
const adminUIUnavail = `      {/* Inasistencias */}
      <div style={{ marginTop: '2rem', padding: '20px', background: 'rgba(255, 152, 0, 0.1)', border: '1px solid rgba(255, 152, 0, 0.3)', borderRadius: '12px' }}>
        <h3 style={{ color: '#ff9800', marginBottom: '16px' }}>🚫 Registrar Inasistencia</h3>
        <p style={{ color: 'var(--glass-text)', marginBottom: '16px', fontSize: '0.9rem' }}>
          Selecciona un usuario y la fecha (Sábado) en la que no podrá asistir. El sistema lo excluirá automáticamente de la rotación para ese día.
        </p>
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <select id="unavail-user" className="input" style={{ flex: 1, minWidth: '150px' }}>
            {TEAM.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input id="unavail-date" type="date" className="input" style={{ flex: 1, minWidth: '150px' }} />
          <button 
            className="btn btn-primary"
            style={{ backgroundColor: '#ff9800', color: 'black' }}
            onClick={() => {
              const uEl = document.getElementById('unavail-user') as HTMLSelectElement;
              const dEl = document.getElementById('unavail-date') as HTMLInputElement;
              if (uEl && dEl && dEl.value) {
                if (onAddUnavailability) onAddUnavailability(dEl.value, uEl.value);
                dEl.value = "";
              } else {
                alert("Selecciona fecha y usuario");
              }
            }}
          >
            Registrar
          </button>
        </div>

        {unavailabilities && unavailabilities.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <h4 style={{ color: 'var(--glass-text)', marginBottom: '8px' }}>Inasistencias Registradas:</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {unavailabilities.map((u, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                  <span><strong style={{ color: '#ff9800' }}>{u.user}</strong> no asiste el <strong>{formatDate(u.date)}</strong></span>
                  <button 
                    onClick={() => onRemoveUnavailability && onRemoveUnavailability(u.date, u.user)}
                    style={{ background: 'none', border: 'none', color: '#d32f2f', cursor: 'pointer', fontSize: '1.2rem' }}
                  >
                    ✖
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '2rem', padding: '20px', background: 'rgba(211,47,47,0.1)', border: '1px solid rgba(211,47,47,0.3)', borderRadius: '12px' }}>`;

content = content.replace(`<div style={{ marginTop: '2rem', padding: '20px', background: 'rgba(211,47,47,0.1)', border: '1px solid rgba(211,47,47,0.3)', borderRadius: '12px' }}>`, adminUIUnavail);

fs.writeFileSync(file, content);
console.log('page.tsx patched');
