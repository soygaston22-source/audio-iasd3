"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { getScheduleForDate, TEAM, getAllFutureShiftsForUser, formatDate } from "@/lib/rotation";
import { db } from "@/lib/firebase";
import { collection, doc, onSnapshot, setDoc, query, orderBy, limit, addDoc, serverTimestamp, getDoc } from "firebase/firestore";

type Role = "ADMIN" | "USER" | null;
type Status = "PENDING" | "CONFIRMED" | "ISSUE" | "CHANGE_REQUESTED";

interface UserState {
  name: string;
  role: Role;
}

interface ActivityEntry {
  id: string;
  date: string;
  action: string;
}

interface FutureChangeRequest {
  id: string;
  user: string;
  date: string;
  shift: string;
  reason: string;
}

const DEFAULT_USER_PASSWORD = "123";

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  
  // App state
  const [currentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<{
    morning: string[];
    afternoon: string[];
    weekNo: number;
    year: number;
    date: string;
  } | null>(null);
  
  // Firebase sync states
  const [userStatuses, setUserStatuses] = useState<Record<string, Status>>({});
  const [userPasswords, setUserPasswords] = useState<Record<string, string>>({});
  const [userNotifications, setUserNotifications] = useState<Record<string, string[]>>({});
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [resetRequests, setResetRequests] = useState<string[]>([]);
  const [futureRequests, setFutureRequests] = useState<FutureChangeRequest[]>([]);

  const addLog = async (action: string) => {
    try {
      await addDoc(collection(db, "activity_logs"), {
        action,
        date: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
        timestamp: serverTimestamp()
      });
    } catch (e) {
      console.error("Error adding log:", e);
    }
  };

  useEffect(() => {
    // 1. Listen to global state
    const unsubGlobal = onSnapshot(doc(db, "app_state", "global"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.schedule) setSchedule(data.schedule);
        if (data.resetRequests) setResetRequests(data.resetRequests);
        if (data.futureRequests) setFutureRequests(data.futureRequests);
      } else {
        // Init global state if not exists
        const sched = getScheduleForDate(new Date());
        setDoc(doc(db, "app_state", "global"), {
          schedule: sched,
          resetRequests: [],
          futureRequests: []
        });
        setSchedule(sched);
      }
    });

    // 2. Listen to users
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const statuses: Record<string, Status> = {};
      const passwords: Record<string, string> = {};
      const notifications: Record<string, string[]> = {};
      
      snap.forEach(docSnap => {
        const data = docSnap.data();
        statuses[docSnap.id] = data.status || "PENDING";
        passwords[docSnap.id] = data.password || DEFAULT_USER_PASSWORD;
        notifications[docSnap.id] = data.notifications || [];
      });
      
      setUserStatuses(statuses);
      setUserPasswords(passwords);
      setUserNotifications(notifications);
    });

    // 3. Listen to activity logs
    const qLogs = query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(20));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      const logs: ActivityEntry[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        logs.push({
          id: docSnap.id,
          date: data.date,
          action: data.action
        });
      });
      setActivityLog(logs);
    });

    // Simulate Splash Screen delay
    setTimeout(() => setLoading(false), 2000);

    return () => {
      unsubGlobal();
      unsubUsers();
      unsubLogs();
    };
  }, []);

  const handleResetRequest = async (name: string) => {
    if (!resetRequests.includes(name)) {
      const newReqs = [...resetRequests, name];
      await setDoc(doc(db, "app_state", "global"), { resetRequests: newReqs }, { merge: true });
      addLog(`🔑 ${name} solicitó restablecimiento de contraseña.`);
      alert("Solicitud enviada al Administrador.");
    } else {
      alert("Ya tienes una solicitud pendiente.");
    }
  };

  const handleLogin = (name: string, role: Role) => {
    if (role === "ADMIN") {
      const pwd = prompt("Ingrese la contraseña de Administrador:");
      if (pwd !== "Rivadavia650**") {
        alert("Contraseña incorrecta.");
        return;
      }
    } else {
      // User login logic
      const currentPwd = userPasswords[name] || DEFAULT_USER_PASSWORD;
      const pwd = prompt(`Ingrese su contraseña (por defecto es ${DEFAULT_USER_PASSWORD}):`);
      if (pwd === null) return; // cancelled
      
      if (pwd !== currentPwd) {
        if (confirm("Contraseña incorrecta. ¿Olvidaste tu contraseña y deseas solicitar un restablecimiento al Administrador?")) {
          handleResetRequest(name);
        }
        return;
      }
    }
    setCurrentUser({ name, role });
  };

  const handleChangePassword = async () => {
    if (!currentUser) return;
    const newPwd = prompt("Ingrese su NUEVA contraseña:");
    if (!newPwd) return;
    const confirmPwd = prompt("Confirme su NUEVA contraseña:");
    if (newPwd !== confirmPwd) {
      alert("Las contraseñas no coinciden. Intente de nuevo.");
      return;
    }
    
    await setDoc(doc(db, "users", currentUser.name), { password: newPwd }, { merge: true });
    addLog(`🔐 ${currentUser.name} ha cambiado su clave de acceso personal.`);
    alert("¡Contraseña actualizada exitosamente!");
  };

  const handleConfirm = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { status: "CONFIRMED" }, { merge: true });
    addLog(`✅ ${currentUser.name} ha confirmado su asistencia para este sábado.`);
    alert("¡Asistencia confirmada!");
  };

  const handleIssue = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { status: "CHANGE_REQUESTED" }, { merge: true });
    addLog(`🔄 ${currentUser.name} ha solicitado un cambio de turno para esta semana.`);
    alert("Notificación enviada al Administrador. Quedará registrado.");
  };

  const handleFutureIssue = async (shiftDate: string, shiftName: string) => {
    if (!currentUser) return;
    const reason = prompt(`Escribe una breve descripción del motivo para cambiar la fecha del ${formatDate(shiftDate)}:`);
    if (!reason) return;

    const newRequest: FutureChangeRequest = {
      id: Math.random().toString(36).substring(2, 9),
      user: currentUser.name,
      date: shiftDate,
      shift: shiftName,
      reason
    };

    const newRequests = [...futureRequests, newRequest];
    await setDoc(doc(db, "app_state", "global"), { futureRequests: newRequests }, { merge: true });
    addLog(`📅 ${currentUser.name} solicitó un cambio para el futuro turno del ${shiftDate}.`);
    alert("Tu solicitud de cambio futuro ha sido enviada al Administrador con éxito.");
  };

  const handleClearNotifications = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { notifications: [] }, { merge: true });
  };

  const handleAdminChange = async (memberToReplace: string) => {
    const newMember = prompt("Ingrese el nombre del reemplazo:");
    if (!newMember) return;
    
    // Add in-app notification to new member
    const newMemberDoc = await getDoc(doc(db, "users", newMember));
    const existingNotifs = newMemberDoc.exists() && newMemberDoc.data().notifications ? newMemberDoc.data().notifications : [];
    const notificationText = `¡Atención! Has sido asignado como reemplazo de ${memberToReplace} para este sábado.`;
    await setDoc(doc(db, "users", newMember), { notifications: [...existingNotifs, notificationText] }, { merge: true });

    alert(`Notificación In-App enviada a ${newMember} y al compañero de turno notificando el cambio.`);
    addLog(`🛠️ Administrador cambió a ${memberToReplace} por ${newMember}.`);
    
    if (schedule) {
      const morning = schedule.morning.map(m => m === memberToReplace ? newMember : m);
      const afternoon = schedule.afternoon.map(m => m === memberToReplace ? newMember : m);
      await setDoc(doc(db, "app_state", "global"), { 
        schedule: { ...schedule, morning, afternoon } 
      }, { merge: true });
    }
    
    // Clear status of old member and set new member to pending
    await setDoc(doc(db, "users", memberToReplace), { status: "PENDING" }, { merge: true });
    await setDoc(doc(db, "users", newMember), { status: "PENDING" }, { merge: true });
  };

  const handleResetPassword = async (userName: string) => {
    await setDoc(doc(db, "users", userName), { password: DEFAULT_USER_PASSWORD }, { merge: true });
    const newReqs = resetRequests.filter(name => name !== userName);
    await setDoc(doc(db, "app_state", "global"), { resetRequests: newReqs }, { merge: true });
    addLog(`🔓 Administrador restableció la contraseña de ${userName}.`);
    alert(`La contraseña de ${userName} ha sido restablecida a "${DEFAULT_USER_PASSWORD}".`);
  };

  const handleDismissFutureRequest = async (id: string) => {
    const newReqs = futureRequests.filter(req => req.id !== id);
    await setDoc(doc(db, "app_state", "global"), { futureRequests: newReqs }, { merge: true });
    alert("Solicitud marcada como leída y eliminada de la lista.");
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
        <Image src="/logo.jpg" alt="Audio IASD Logo" width={150} height={150} style={{ marginBottom: '2rem', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
        <p style={{ fontSize: '1.2rem', fontWeight: '500', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Cargando aplicación...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="content" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Image src="/logo.jpg" alt="Audio IASD Logo" width={100} height={100} style={{ borderRadius: '16px', boxShadow: '0 8px 16px rgba(0,0,0,0.3)', marginBottom: '1rem' }} />
          <h2 style={{ color: 'var(--glass-text)' }}>Ingresar a Audio IASD</h2>
        </div>
        
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ marginBottom: '10px' }}>Usuarios</h3>
          {TEAM.map(member => (
            <button key={member} className="btn btn-outline" onClick={() => handleLogin(member, "USER")} style={{ position: 'relative' }}>
              Ingresar como {member}
              {userNotifications[member]?.length > 0 && (
                <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', backgroundColor: '#ef6c00', width: '12px', height: '12px', borderRadius: '50%' }}></span>
              )}
            </button>
          ))}
          
          <h3 style={{ marginTop: '2rem', marginBottom: '10px' }}>Administrador</h3>
          <button className="btn btn-primary" onClick={() => handleLogin("Admin", "ADMIN")}>
            Ingresar como Administrador
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="app-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Image src="/logo.jpg" alt="Logo" width={40} height={40} style={{ borderRadius: '8px' }} />
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Audio IASD</h2>
        </div>
        <button 
          onClick={() => setCurrentUser(null)}
          style={{ background: 'none', border: 'none', color: 'white', textDecoration: 'underline', cursor: 'pointer', fontSize: '1rem' }}
        >
          Salir
        </button>
      </header>

      <main className="content">
        {currentUser.role === "USER" && schedule && (
          <UserView 
            currentDate={currentDate}
            schedule={schedule} 
            userName={currentUser.name} 
            status={userStatuses[currentUser.name] || "PENDING"}
            notifications={userNotifications[currentUser.name] || []}
            futureRequests={futureRequests}
            onConfirm={handleConfirm}
            onIssue={handleIssue}
            onFutureIssue={handleFutureIssue}
            onChangePassword={handleChangePassword}
            onClearNotifications={handleClearNotifications}
          />
        )}

        {currentUser.role === "ADMIN" && schedule && (
          <AdminView 
            schedule={schedule}
            statuses={userStatuses}
            activityLog={activityLog}
            resetRequests={resetRequests}
            futureRequests={futureRequests}
            onChangeAssignment={handleAdminChange}
            onResetPassword={handleResetPassword}
            onDismissFutureRequest={handleDismissFutureRequest}
          />
        )}
      </main>
    </>
  );
}

function UserView({ currentDate, schedule, userName, status, notifications, futureRequests, onConfirm, onIssue, onFutureIssue, onChangePassword, onClearNotifications }: { 
  currentDate: Date, schedule: any, userName: string, status: Status, notifications: string[], futureRequests: FutureChangeRequest[], onConfirm: () => void, onIssue: () => void, onFutureIssue: (date: string, shift: string) => void, onChangePassword: () => void, onClearNotifications: () => void 
}) {
  const isSunday = currentDate.getDay() === 0;
  const searchFrom = isSunday ? new Date(currentDate.getTime() + 86400000) : currentDate;
  
  const futureShifts = getAllFutureShiftsForUser(userName, searchFrom, 5);
  
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h4 style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '1px' }}>
          {formatDate(currentDate)}
        </h4>
        <h3 style={{ textShadow: '0 2px 4px rgba(255,255,255,0.5)' }}>Hola, {userName}</h3>
        <button onClick={onChangePassword} style={{ marginTop: '10px', background: 'none', border: 'none', color: 'var(--primary-red)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}>
          Cambiar mi clave
        </button>
      </div>

      {notifications.length > 0 && (
        <div className="glass-card" style={{ backgroundColor: 'rgba(239, 108, 0, 0.1)', border: '1px solid rgba(239, 108, 0, 0.4)', marginBottom: '24px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef6c00', marginBottom: '12px' }}>
            <span style={{ fontSize: '1.5rem' }}>🔔</span>
            <strong style={{ fontSize: '1.1rem' }}>Nueva Notificación</strong>
          </div>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px 0', color: 'var(--glass-text)' }}>
            {notifications.map((msg, idx) => <li key={idx} style={{ marginBottom: '8px' }}>{msg}</li>)}
          </ul>
          <button className="btn btn-primary" onClick={onClearNotifications} style={{ width: '100%', padding: '10px', backgroundColor: '#ef6c00' }}>
            Entendido
          </button>
        </div>
      )}

      {futureShifts.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.1rem' }}>No tienes turnos asignados próximamente.</p>
        </div>
      ) : (
        <div>
          <h4 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>Mis Próximos Turnos</h4>
          <div style={{ display: 'flex', overflowX: 'auto', gap: '16px', paddingBottom: '16px', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
            {futureShifts.map((shiftInfo, idx) => {
              const isCurrentWeek = shiftInfo.date === schedule.date;
              const hasRequestedFutureChange = futureRequests.some(r => r.date === shiftInfo.date && r.user === userName);

              return (
                <div key={idx} className="glass-card" style={{ minWidth: '85%', scrollSnapAlign: 'start', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                  {idx === 0 && <div style={{ position: 'absolute', top: 0, right: 0, backgroundColor: 'rgba(164,52,49,0.2)', padding: '4px 12px', borderBottomLeftRadius: '12px', fontSize: '0.8rem', color: 'var(--primary-red)', fontWeight: 'bold' }}>El más próximo</div>}
                  <h4 style={{ color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', fontSize: '0.85rem' }}>Fecha</h4>
                  <h2 style={{ color: 'var(--primary-red)', marginBottom: '4px', fontSize: '1.5rem', textShadow: '0 2px 4px rgba(255,255,255,0.5)', textTransform: 'capitalize' }}>
                    {formatDate(shiftInfo.date)}
                  </h2>
                  <p style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '16px' }}>Turno {shiftInfo.shift}</p>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                    {isCurrentWeek ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {status === "PENDING" && (
                          <>
                            <button className="btn btn-success" onClick={onConfirm} style={{ padding: '8px', fontSize: '0.9rem' }}>Confirmar Asistencia</button>
                            <button className="btn btn-warning" onClick={onIssue} style={{ padding: '8px', fontSize: '0.9rem' }}>Solicitar Cambio</button>
                          </>
                        )}
                        {status === "CONFIRMED" && <div style={{ color: '#4caf50', fontWeight: 'bold', textAlign: 'center' }}>✓ Confirmado</div>}
                        {status === "CHANGE_REQUESTED" && <div style={{ color: '#ff9800', fontWeight: 'bold', textAlign: 'center' }}>🔄 Cambio solicitado</div>}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {hasRequestedFutureChange ? (
                          <div style={{ color: '#ff9800', fontWeight: 'bold', textAlign: 'center', fontSize: '0.9rem' }}>🔄 Solicitud enviada</div>
                        ) : (
                          <button className="btn btn-outline" onClick={() => onFutureIssue(shiftInfo.date, shiftInfo.shift)} style={{ padding: '8px', fontSize: '0.9rem' }}>
                            Solicitar Cambio de Fecha
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminView({ schedule, statuses, activityLog, resetRequests, futureRequests, onChangeAssignment, onResetPassword, onDismissFutureRequest }: { 
  schedule: any, statuses: Record<string, Status>, activityLog: ActivityEntry[], resetRequests: string[], futureRequests: FutureChangeRequest[], onChangeAssignment: (member: string) => void, onResetPassword: (member: string) => void, onDismissFutureRequest: (id: string) => void 
}) {
  const renderShift = (title: string, members: string[]) => (
    <div style={{ marginBottom: '24px' }}>
      <h3 style={{ borderBottom: '2px solid var(--primary-red)', paddingBottom: '8px', marginBottom: '16px' }}>
        Turno {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {members.map(member => {
          const status = statuses[member] || 'PENDING';
          let statusColor = '#9e9e9e';
          let statusText = 'Pendiente';
          
          if (status === 'CONFIRMED') { statusColor = '#2e7d32'; statusText = 'Confirmado'; }
          if (status === 'CHANGE_REQUESTED') { statusColor = '#ef6c00'; statusText = 'CAMBIO SOLICITADO'; }
          if (status === 'ISSUE') { statusColor = '#d32f2f'; statusText = 'INCONVENIENTE'; }

          return (
            <div key={member} className="glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', border: `1px solid ${status === 'CHANGE_REQUESTED' ? '#ef6c00' : 'var(--glass-border)'}` }}>
              <div>
                <strong style={{ display: 'block', fontSize: '1.1rem' }}>{member}</strong>
                <span style={{ color: statusColor, fontSize: '0.85rem', fontWeight: 'bold', textShadow: '0 1px 2px rgba(255,255,255,0.8)' }}>{statusText}</span>
              </div>
              <button 
                onClick={() => onChangeAssignment(member)}
                style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.2)', border: '1px solid var(--glass-border)', color: 'var(--glass-text)', borderRadius: '6px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
              >
                Cambiar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h3 style={{ textShadow: '0 2px 4px rgba(255,255,255,0.5)' }}>Panel de Administrador</h3>
        <p style={{ color: 'var(--text-muted)' }}>Semana {schedule.weekNo} - {schedule.year}</p>
      </div>

      <div className="glass-card" style={{ backgroundColor: 'rgba(239, 108, 0, 0.1)', color: '#ef6c00', border: '1px solid rgba(239, 108, 0, 0.3)', marginBottom: '24px', fontSize: '0.9rem' }}>
        <strong>Nota:</strong> Los cambios manuales dispararán notificaciones In-App automáticas a los reemplazos.
      </div>

      {futureRequests.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ color: '#ff9800', borderBottom: '2px solid #ff9800', paddingBottom: '8px', marginBottom: '16px' }}>
            Solicitudes de Cambio (Futuras)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {futureRequests.map(req => (
              <div key={req.id} className="glass-card" style={{ border: '1px solid #ff9800', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <strong style={{ display: 'block', fontSize: '1.1rem', color: '#ff9800' }}>{req.user}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--glass-text)', textTransform: 'capitalize' }}>{formatDate(req.date)} - {req.shift}</span>
                  </div>
                  <button 
                    onClick={() => onDismissFutureRequest(req.id)}
                    style={{ padding: '6px 10px', background: 'none', color: 'var(--glass-text)', border: '1px solid var(--glass-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Marcar Leída
                  </button>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', fontSize: '0.9rem', fontStyle: 'italic', color: '#e0e0e0' }}>
                  "{req.reason}"
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {resetRequests.length > 0 && (
        <div className="glass-card" style={{ backgroundColor: 'rgba(211, 47, 47, 0.1)', border: '1px solid rgba(211, 47, 47, 0.3)', marginBottom: '24px' }}>
          <h3 style={{ color: '#d32f2f', marginBottom: '12px' }}>⚠ Solicitudes de Contraseña</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {resetRequests.map(req => (
              <div key={req} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.5)', borderRadius: '8px' }}>
                <strong style={{ color: '#d32f2f' }}>{req}</strong>
                <button 
                  onClick={() => onResetPassword(req)}
                  style={{ padding: '6px 12px', background: '#d32f2f', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Restablecer a 123
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {renderShift("Mañana", schedule.morning)}
      {renderShift("Tarde", schedule.afternoon)}

      <div style={{ marginTop: '2rem' }}>
        <h3 style={{ borderBottom: '2px solid var(--glass-border)', paddingBottom: '8px', marginBottom: '16px' }}>Registro de Actividad</h3>
        {activityLog.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>No hay actividad reciente.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activityLog.map(log => (
              <div key={log.id} className="glass-card" style={{ padding: '12px', fontSize: '0.9rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{log.date}</div>
                <div>{log.action}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

