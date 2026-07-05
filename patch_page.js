const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add aiSchedules state
if (!content.includes('const [aiSchedules, setAiSchedules]')) {
  content = content.replace(
    'const [announcements, setAnnouncements] = useState<Announcement[]>([]);',
    'const [announcements, setAnnouncements] = useState<Announcement[]>([]);\n  const [aiSchedules, setAiSchedules] = useState<any[]>([]);'
  );
}

// 2. Add aiSchedules to onSnapshot global
if (!content.includes('if (data.aiSchedules) setAiSchedules(data.aiSchedules);')) {
  content = content.replace(
    'if (data.youtubeLiveUrl !== undefined) setYoutubeLiveUrl(data.youtubeLiveUrl);',
    'if (data.youtubeLiveUrl !== undefined) setYoutubeLiveUrl(data.youtubeLiveUrl);\n        if (data.aiSchedules) setAiSchedules(data.aiSchedules);'
  );
}

// 3. Update the fallback getScheduleForDate
if (content.includes('const sched = getScheduleForDate(new Date(), [], 0);')) {
  content = content.replace(
    'const sched = getScheduleForDate(new Date(), [], 0);',
    `const sched = { morning: [], afternoon: [], date: new Date().toISOString().split('T')[0] };`
  );
  content = content.replace(
    'seedOffset: 0,',
    'seedOffset: 0,\n          aiSchedules: [],'
  );
}

// 4. Update the RollOver Logic
const oldRollover = `      const expectedSched = getScheduleForDate(today, approvedSwaps, seedOffset);

      if (schedule.date !== expectedSched.date) {`;

const newRollover = `      // Find the currently applicable schedule from aiSchedules
      const todayStr = today.toISOString().split('T')[0];
      // We want the closest aiSchedule whose date is >= today, or just take the first future one.
      const expectedSched = aiSchedules.find(s => s.date >= todayStr) || schedule;

      if (expectedSched && expectedSched.date && schedule.date !== expectedSched.date && expectedSched.date > schedule.date) {`;

content = content.replace(oldRollover, newRollover);

// 5. Delete random reassign button and function
// Let's remove handleRandomReassign
content = content.replace(/const handleRandomReassign = async \(\) => \{[\s\S]*?alert\("¡Éxito! Todos los turnos han sido reasignados aleatoriamente y los trueques han sido limpiados\."\);\n  \};/g, '');

// Also remove it from AdminView props
content = content.replace(/onRandomReassign: \(\) => void, /g, '');
content = content.replace(/onRandomReassign, /g, '');

// And remove the UI block in AdminView for random reassign
const randomBlock = `          <div className="glass-card" style={{ padding: '16px', background: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.3)' }}>
            <h4 style={{ color: '#f44336', marginBottom: '8px' }}>🎲 Reasignar Todos los Turnos (Peligro)</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Al presionar este botón, se calculará una nueva rotación aleatoria para todas las semanas futuras y se borrarán todos los trueques pendientes o aprobados.
            </p>
            <button 
              className="btn btn-primary"
              onClick={() => {
                if(window.confirm("¿Estás 100% seguro? Esto borrará los trueques y reasignará todos los turnos futuros aleatoriamente para todos los miembros.")) {
                  onRandomReassign();
                }
              }}
              style={{ width: '100%', backgroundColor: '#d32f2f' }}
            >
              🎲 Asignar Aleatoriamente
            </button>
          </div>`;
content = content.replace(randomBlock, '');

// 6. Update UserView's call to getAllFutureShiftsForUser
content = content.replace(
  'const futureShifts = getAllFutureShiftsForUser(userName, searchFrom, 5, approvedSwaps, seedOffset);',
  'const futureShifts = getAllFutureShiftsForUser(userName, aiSchedules, 5, approvedSwaps);'
);

// Add aiSchedules to UserView props
content = content.replace(
  'function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, specialShifts, seedOffset, announcements',
  'function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, specialShifts, seedOffset, announcements, aiSchedules'
);
content = content.replace(
  'currentDate: Date, schedule: any, userName: string, status: Status, notifications: string[], pendingSwaps: PendingSwap[], approvedSwaps: ApprovedSwap[], specialShifts: SpecialShift[], seedOffset: number, announcements: Announcement[],',
  'currentDate: Date, schedule: any, userName: string, status: Status, notifications: string[], pendingSwaps: PendingSwap[], approvedSwaps: ApprovedSwap[], specialShifts: SpecialShift[], seedOffset: number, announcements: Announcement[], aiSchedules: any[],'
);
content = content.replace(
  '<UserView \n            currentDate={currentDate}',
  '<UserView \n            currentDate={currentDate}\n            aiSchedules={aiSchedules}'
);

// 7. Update handlePublishGrid to also write to aiSchedules
const publishGridOld = `      await addDoc(collection(db, "announcements"), {
        text: "Nuevo cronograma publicado",
        type: "schedule_grid",
        gridData: aiAdminResult,
        timestamp: serverTimestamp(),
        author: "Administrador (IA)"
      });
      alert("Cronograma publicado con éxito en Novedades.");`;

const publishGridNew = `      await addDoc(collection(db, "announcements"), {
        text: "Nuevo cronograma publicado",
        type: "schedule_grid",
        gridData: aiAdminResult,
        timestamp: serverTimestamp(),
        author: "Administrador (IA)"
      });
      
      // Convert to AIScheduleWeek format and push to Firebase global state
      if (aiAdminResult.rows && Array.isArray(aiAdminResult.rows)) {
        const newAiWeeks = aiAdminResult.rows.map((row: any) => ({
          date: row.dateIso || new Date().toISOString().split('T')[0], // Fallback if missing
          morning: row.morning.split('-').map((n: string) => n.trim()),
          afternoon: row.afternoon.split('-').map((n: string) => n.trim())
        }));
        
        // Append or merge with existing aiSchedules? 
        // Let's fetch current first, or we can just arrayUnion (but arrayUnion has limits).
        // Since aiSchedules is just an array, we can pull the latest snapshot and append.
        const docSnap = await getDoc(doc(db, "app_state", "global"));
        if (docSnap.exists()) {
           const currentSchedules = docSnap.data().aiSchedules || [];
           // Overwrite schedules that have the same date, append new ones
           const mergedSchedules = [...currentSchedules];
           newAiWeeks.forEach((nw: any) => {
              const existingIdx = mergedSchedules.findIndex(s => s.date === nw.date);
              if (existingIdx >= 0) mergedSchedules[existingIdx] = nw;
              else mergedSchedules.push(nw);
           });
           await setDoc(doc(db, "app_state", "global"), { aiSchedules: mergedSchedules }, { merge: true });
        }
      }

      alert("Cronograma publicado en Novedades y Motor Actualizado con éxito.");`;

content = content.replace(publishGridOld, publishGridNew);

// Add import getDoc if not there
if (!content.includes('getDoc,')) {
    content = content.replace('setDoc, addDoc', 'setDoc, addDoc, getDoc');
}

fs.writeFileSync(file, content);
console.log('Patched page.tsx successfully!');
