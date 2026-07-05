const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Interface
if (!content.includes('interface SpecialShift')) {
  content = content.replace(
    'interface FutureChangeRequest {',
    `export interface SpecialShift {
  id: string;
  title: string;
  date: string;
  members: string[];
  fileUrl?: string;
  fileName?: string;
}

interface FutureChangeRequest {`
  );
}

// 2. State
if (!content.includes('const [specialShifts, setSpecialShifts] = useState')) {
  content = content.replace(
    'const [futureRequests, setFutureRequests] = useState<FutureChangeRequest[]>([]);',
    `const [futureRequests, setFutureRequests] = useState<FutureChangeRequest[]>([]);
  const [specialShifts, setSpecialShifts] = useState<SpecialShift[]>([]);`
  );
}

// 3. onSnapshot Firebase sync
if (!content.includes('if (data.specialShifts) setSpecialShifts(data.specialShifts);')) {
  content = content.replace(
    'if (data.futureRequests) setFutureRequests(data.futureRequests);',
    `if (data.futureRequests) setFutureRequests(data.futureRequests);
        if (data.specialShifts) setSpecialShifts(data.specialShifts);`
  );
  
  content = content.replace(
    'futureRequests: []',
    `futureRequests: [],
          specialShifts: []`
  );
}

// 4. Props to UserView and AdminView
if (!content.includes('specialShifts={specialShifts}')) {
  content = content.replace(
    '<UserView ',
    `<UserView \n            specialShifts={specialShifts}`
  );
  content = content.replace(
    '<AdminView ',
    `<AdminView \n            specialShifts={specialShifts}`
  );
}

// 5. UserView signature and UI
if (!content.includes('specialShifts: SpecialShift[]')) {
  content = content.replace(
    'approvedSwaps: ApprovedSwap[], onConfirm: () => void',
    `approvedSwaps: ApprovedSwap[], specialShifts: SpecialShift[], onConfirm: () => void`
  );
  content = content.replace(
    'approvedSwaps, onConfirm',
    `approvedSwaps, specialShifts, onConfirm`
  );
  
  // Inject into UserView UI (right before "Mis Próximos Turnos")
  const userUI = `
          {/* Turnos Especiales */}
          {specialShifts.filter(ss => ss.members.includes(userName)).length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px', fontSize: '1.1rem', color: '#ff9800' }}>⭐ Mis Turnos Especiales</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {specialShifts.filter(ss => ss.members.includes(userName)).map((shift) => (
                  <div key={shift.id} className="glass-card" style={{ border: '1px solid rgba(255, 152, 0, 0.5)', background: 'rgba(255, 152, 0, 0.1)' }}>
                    <h3 style={{ color: '#ff9800', marginBottom: '8px' }}>{shift.title}</h3>
                    <p style={{ fontWeight: 'bold' }}>{formatDate(shift.date)}</p>
                    <p style={{ fontSize: '0.9rem', marginTop: '8px', color: 'var(--text-muted)' }}>
                      Junto a: {shift.members.filter(m => m !== userName).join(', ')}
                    </p>
                    {shift.fileUrl && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,152,0,0.3)' }}>
                        <a 
                          href={shift.fileUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="btn btn-outline"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '0.9rem', color: '#ff9800', borderColor: '#ff9800' }}
                        >
                          📎 Ver Archivo Adjunto ({shift.fileName})
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>Mis Próximos Turnos</h4>`;
  content = content.replace(`<h4 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>Mis Próximos Turnos</h4>`, userUI);
}

// 6. AdminView signature and UI
if (!content.includes('specialShifts: SpecialShift[]')) {
  // Add to props
  content = content.replace(
    'approvedSwaps: ApprovedSwap[], onChangeAssignment: (member: string) => void',
    `approvedSwaps: ApprovedSwap[], specialShifts: SpecialShift[], onChangeAssignment: (member: string) => void`
  );
  content = content.replace(
    'approvedSwaps, onChangeAssignment',
    `approvedSwaps, specialShifts, onChangeAssignment`
  );
  
  // Inject state into AdminView
  const adminState = `
  const [specialShiftTitle, setSpecialShiftTitle] = useState("");
  const [specialShiftDate, setSpecialShiftDate] = useState("");
  const [specialShiftMembers, setSpecialShiftMembers] = useState<string[]>([]);
  const [specialShiftFile, setSpecialShiftFile] = useState<File | null>(null);
  const [isCreatingSpecial, setIsCreatingSpecial] = useState(false);
  const specialFileInputRef = useRef<HTMLInputElement>(null);

  const handleToggleSpecialMember = (member: string) => {
    setSpecialShiftMembers(prev => 
      prev.includes(member) ? prev.filter(m => m !== member) : [...prev, member]
    );
  };

  const handleCreateSpecialShift = async () => {
    if (!specialShiftTitle.trim() || !specialShiftDate || specialShiftMembers.length === 0) {
      alert("Debes escribir un título, seleccionar una fecha y al menos un miembro.");
      return;
    }
    setIsCreatingSpecial(true);
    try {
      let fileUrl = "";
      let fileName = "";
      if (specialShiftFile) {
        const storageRef = ref(storage, \`special_shifts/\${Date.now()}_\${specialShiftFile.name}\`);
        const snapshot = await uploadBytes(storageRef, specialShiftFile);
        fileUrl = await getDownloadURL(snapshot.ref);
        fileName = specialShiftFile.name;
      }

      const newShift: SpecialShift = {
        id: Date.now().toString(),
        title: specialShiftTitle.trim(),
        date: specialShiftDate,
        members: specialShiftMembers,
        fileUrl,
        fileName
      };
      await updateDoc(doc(db, "app_state", "global"), {
        specialShifts: [...specialShifts, newShift]
      });
      setSpecialShiftTitle("");
      setSpecialShiftDate("");
      setSpecialShiftMembers([]);
      setSpecialShiftFile(null);
      alert("Turno Especial creado con éxito.");
      
      specialShiftMembers.forEach(member => {
        sendPush(member, \`⭐ Nuevo Turno Especial\`, \`Has sido asignado a: \${newShift.title}\`);
      });
    } catch (e: any) {
      alert("Error al crear turno especial: " + e.message);
    } finally {
      setIsCreatingSpecial(false);
    }
  };

  const handleDeleteSpecialShift = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar este turno especial?")) return;
    try {
      const updated = specialShifts.filter(s => s.id !== id);
      await updateDoc(doc(db, "app_state", "global"), {
        specialShifts: updated
      });
    } catch (e: any) {
      alert("Error al eliminar turno: " + e.message);
    }
  };

  const [newsTitle`;
  content = content.replace(`const [newsTitle`, adminState);
  
  // Inject UI into AdminView (before P2P Swaps)
  const adminUI = `
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#ff9800', borderBottom: '2px solid #ff9800', paddingBottom: '8px', marginBottom: '16px' }}>
              ⭐ Gestión de Turnos Especiales
            </h3>
            
            <div className="glass-card" style={{ padding: '16px', marginBottom: '16px', border: '1px solid rgba(255, 152, 0, 0.5)' }}>
              <h4 style={{ marginBottom: '12px' }}>Crear Nuevo Turno Especial</h4>
              <input 
                type="text" 
                placeholder="Actividad (ej: Campaña Evangelística)" 
                value={specialShiftTitle}
                onChange={(e) => setSpecialShiftTitle(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', marginBottom: '12px' }}
              />
              <input 
                type="date" 
                value={specialShiftDate}
                onChange={(e) => setSpecialShiftDate(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', marginBottom: '12px' }}
              />
              
              <div style={{ marginBottom: '12px' }}>
                <p style={{ marginBottom: '8px', fontSize: '0.9rem' }}>Seleccionar Miembros:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {TEAM.map(member => (
                    <button
                      key={member}
                      onClick={() => handleToggleSpecialMember(member)}
                      className="btn btn-outline"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        backgroundColor: specialShiftMembers.includes(member) ? 'var(--primary-red)' : 'transparent',
                        color: specialShiftMembers.includes(member) ? 'white' : 'var(--glass-text)',
                        borderColor: specialShiftMembers.includes(member) ? 'var(--primary-red)' : 'var(--glass-border)'
                      }}
                    >
                      {member}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                  type="file" 
                  ref={specialFileInputRef}
                  onChange={(e) => setSpecialShiftFile(e.target.files?.[0] || null)}
                  style={{ display: 'none' }}
                />
                <button 
                  className="btn btn-outline"
                  onClick={() => specialFileInputRef.current?.click()}
                  style={{ padding: '8px 16px', fontSize: '0.9rem', borderColor: '#ff9800', color: '#ff9800' }}
                >
                  📎 {specialShiftFile ? specialShiftFile.name : 'Adjuntar Archivo (Opcional)'}
                </button>
              </div>

              <button 
                className="btn btn-primary"
                onClick={handleCreateSpecialShift}
                disabled={isCreatingSpecial}
                style={{ width: '100%', backgroundColor: '#ff9800' }}
              >
                {isCreatingSpecial ? "Creando..." : "Crear Turno Especial"}
              </button>
            </div>

            {specialShifts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {specialShifts.map(shift => (
                  <div key={shift.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(255, 152, 0, 0.1)', border: '1px solid rgba(255, 152, 0, 0.3)' }}>
                    <div>
                      <strong style={{ color: '#ff9800', display: 'block' }}>{shift.title}</strong>
                      <span style={{ fontSize: '0.85rem', color: 'var(--glass-text)' }}>{formatDate(shift.date)}</span>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {shift.members.join(', ')}
                      </div>
                      {shift.fileUrl && (
                        <div style={{ marginTop: '6px', fontSize: '0.85rem' }}>
                          <a href={shift.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#ff9800' }}>
                            📎 {shift.fileName}
                          </a>
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={() => handleDeleteSpecialShift(shift.id)}
                      style={{ background: 'none', border: 'none', color: '#d32f2f', fontSize: '1.2rem', cursor: 'pointer', padding: '8px' }}
                      title="Eliminar Turno"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#4caf50', borderBottom: '2px solid #4caf50', paddingBottom: '8px', marginBottom: '16px' }}>`;
  content = content.replace(`<div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#4caf50', borderBottom: '2px solid #4caf50', paddingBottom: '8px', marginBottom: '16px' }}>`, adminUI);
}

fs.writeFileSync(file, content);
console.log('Patched page.tsx successfully!');
