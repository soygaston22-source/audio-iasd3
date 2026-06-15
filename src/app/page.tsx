"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { getScheduleForDate, TEAM, getAllFutureShiftsForUser, formatDate, ApprovedSwap } from "@/lib/rotation";
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

interface PendingSwap {
  id: string;
  fromUser: string;
  fromDate: string;
  fromShift: string;
  toUser: string;
  toDate: string;
  toShift: string;
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
  const [pendingSwaps, setPendingSwaps] = useState<PendingSwap[]>([]);
  const [approvedSwaps, setApprovedSwaps] = useState<ApprovedSwap[]>([]);

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
        if (data.pendingSwaps) setPendingSwaps(data.pendingSwaps);
        if (data.approvedSwaps) setApprovedSwaps(data.approvedSwaps);
      } else {
        // Init global state if not exists
        const sched = getScheduleForDate(new Date());
        setDoc(doc(db, "app_state", "global"), {
          schedule: sched,
          resetRequests: [],
          futureRequests: [],
          pendingSwaps: [],
          approvedSwaps: []
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

    setTimeout(() => setLoading(false), 2000);

    return () => {
      unsubGlobal();
      unsubUsers();
      unsubLogs();
    };
  }, []);

  useEffect(() => {
    // Check if the current global schedule is outdated and roll over to the new week.
    if (schedule) {
      const today = new Date();
      if (today.getDay() === 0) today.setDate(today.getDate() + 1); // Sunday belongs to next week's schedule
      const expectedSched = getScheduleForDate(today, approvedSwaps);

      if (schedule.date !== expectedSched.date) {
        // Schedule is outdated! Roll it forward.
        const rollOver = async () => {
          TEAM.forEach(member => {
            setDoc(doc(db, "users", member), { status: "PENDING" }, { merge: true });
          });
          await setDoc(doc(db, "app_state", "global"), { schedule: expectedSched }, { merge: true });
          await addDoc(collection(db, "activity_logs"), {
            action: `🔄 Sistema automático: Comenzó la semana del ${formatDate(expectedSched.date)}.`,
            date: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
            timestamp: serverTimestamp()
          });
        };
        rollOver();
      }
    }
  }, [schedule, approvedSwaps]);

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
      const currentPwd = userPasswords[name] || DEFAULT_USER_PASSWORD;
      const pwd = prompt(`Ingrese su contraseña (por defecto es ${DEFAULT_USER_PASSWORD}):`);
      if (pwd === null) return; 
      
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
    
    const targetName = prompt(`Ingresa el nombre del compañero con quien deseas intercambiar (ejemplo: Gaston):\\nCompañeros: ${TEAM.filter(t => t !== currentUser.name).join(", ")}`);
    if (!targetName) return;

    // Normalize name
    const targetUser = TEAM.find(t => t.toLowerCase() === targetName.toLowerCase().trim());
    if (!targetUser) {
      alert("El nombre ingresado no pertenece al equipo. Intenta nuevamente.");
      return;
    }

    // Find target user's next shift
    const today = new Date();
    if (today.getDay() === 0) today.setDate(today.getDate() + 1);
    const targetShifts = getAllFutureShiftsForUser(targetUser, today, 1, approvedSwaps);
    
    if (targetShifts.length === 0) {
      alert(`${targetUser} no tiene turnos asignados en el futuro cercano para intercambiar.`);
      return;
    }

    const targetShift = targetShifts[0];

    if (confirm(`El próximo turno de ${targetUser} es el ${formatDate(targetShift.date)} (${targetShift.shift}).\\n\\n¿Deseas proponerle cambiar tu turno del ${formatDate(shiftDate)} por el de él?`)) {
      const newSwap: PendingSwap = {
        id: Math.random().toString(36).substring(2, 9),
        fromUser: currentUser.name,
        fromDate: shiftDate,
        fromShift: shiftName,
        toUser: targetUser,
        toDate: targetShift.date,
        toShift: targetShift.shift
      };

      const newPending = [...pendingSwaps, newSwap];
      await setDoc(doc(db, "app_state", "global"), { pendingSwaps: newPending }, { merge: true });
      addLog(`📩 ${currentUser.name} le propuso un trueque de turnos a ${targetUser}.`);
      alert(`¡Propuesta enviada a ${targetUser}! Cuando él inicie sesión podrá aceptarla o rechazarla.`);
    }
  };

  const handleAcceptSwap = async (swap: PendingSwap) => {
    const newPending = pendingSwaps.filter(s => s.id !== swap.id);
    const newApproved = [...approvedSwaps, {
      date1: swap.fromDate,
      user1: swap.fromUser,
      date2: swap.toDate,
      user2: swap.toUser
    }];

    let newSchedule = schedule;
    if (schedule && (schedule.date === swap.fromDate || schedule.date === swap.toDate)) {
      newSchedule = getScheduleForDate(new Date(`${schedule.date}T12:00:00`), newApproved);
    }

    await setDoc(doc(db, "app_state", "global"), { 
      pendingSwaps: newPending, 
      approvedSwaps: newApproved,
      ...(newSchedule && { schedule: newSchedule })
    }, { merge: true });

    addLog(`🤝 TRUEQUE: ${swap.fromUser} y ${swap.toUser} intercambiaron turnos exitosamente.`);
    alert("¡Intercambio realizado! El calendario de todos ha sido actualizado mágicamente.");
  };

  const handleRejectSwap = async (swap: PendingSwap) => {
    const newPending = pendingSwaps.filter(s => s.id !== swap.id);
    await setDoc(doc(db, "app_state", "global"), { pendingSwaps: newPending }, { merge: true });
    
    // Add notification to the proposer
    const proposerDoc = await getDoc(doc(db, "users", swap.fromUser));
    const notifs = proposerDoc.exists() && proposerDoc.data().notifications ? proposerDoc.data().notifications : [];
    await setDoc(doc(db, "users", swap.fromUser), { 
      notifications: [...notifs, `${swap.toUser} ha rechazado tu propuesta de cambio de turno.`] 
    }, { merge: true });

    alert("Propuesta rechazada. Se ha notificado al compañero.");
  };

  const handleClearNotifications = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { notifications: [] }, { merge: true });
  };

  const handleAdminChange = async (memberToReplace: string) => {
    const newMember = prompt("Ingrese el nombre del reemplazo:");
    if (!newMember) return;
    
    const newMemberDoc = await getDoc(doc(db, "users", newMember));
    const existingNotifs = newMemberDoc.exists() && newMemberDoc.data().notifications ? newMemberDoc.data().notifications : [];
    const notificationText = `¡Atención! Has sido asignado como reemplazo manual de ${memberToReplace} para este sábado.`;
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
            pendingSwaps={pendingSwaps.filter(s => s.toUser === currentUser.name)}
            approvedSwaps={approvedSwaps}
            onConfirm={handleConfirm}
            onIssue={handleIssue}
            onFutureIssue={handleFutureIssue}
            onChangePassword={handleChangePassword}
            onClearNotifications={handleClearNotifications}
            onAcceptSwap={handleAcceptSwap}
            onRejectSwap={handleRejectSwap}
          />
        )}

        {currentUser.role === "ADMIN" && schedule && (
          <AdminView 
            schedule={schedule}
            statuses={userStatuses}
            activityLog={activityLog}
            resetRequests={resetRequests}
            futureRequests={futureRequests}
            approvedSwaps={approvedSwaps}
            onChangeAssignment={handleAdminChange}
            onResetPassword={handleResetPassword}
            onDismissFutureRequest={handleDismissFutureRequest}
          />
        )}
      </main>
    </>
  );
}

function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, onConfirm, onIssue, onFutureIssue, onChangePassword, onClearNotifications, onAcceptSwap, onRejectSwap }: { 
  currentDate: Date, schedule: any, userName: string, status: Status, notifications: string[], pendingSwaps: PendingSwap[], approvedSwaps: ApprovedSwap[], onConfirm: () => void, onIssue: () => void, onFutureIssue: (date: string, shift: string) => void, onChangePassword: () => void, onClearNotifications: () => void, onAcceptSwap: (swap: PendingSwap) => void, onRejectSwap: (swap: PendingSwap) => void
}) {
  const isSunday = currentDate.getDay() === 0;
  const searchFrom = isSunday ? new Date(currentDate.getTime() + 86400000) : currentDate;
  
  const futureShifts = getAllFutureShiftsForUser(userName, searchFrom, 5, approvedSwaps);
  
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

      {pendingSwaps.map(swap => (
        <div key={swap.id} className="glass-card" style={{ backgroundColor: 'rgba(46, 125, 50, 0.1)', border: '2px solid #4caf50', marginBottom: '24px', position: 'relative' }}>
          <h3 style={{ color: '#4caf50', marginBottom: '12px', fontSize: '1.2rem' }}>🤝 ¡Propuesta de Trueque!</h3>
          <p style={{ marginBottom: '16px', fontSize: '1.05rem', lineHeight: '1.5' }}>
            <strong>{swap.fromUser}</strong> te propone intercambiar su turno del <strong>{formatDate(swap.fromDate)}</strong> a cambio de tu turno del <strong>{formatDate(swap.toDate)}</strong>.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-success" onClick={() => onAcceptSwap(swap)} style={{ flex: 1, padding: '12px' }}>
              Aceptar Trueque
            </button>
            <button className="btn btn-outline" onClick={() => onRejectSwap(swap)} style={{ flex: 1, padding: '12px', borderColor: '#d32f2f', color: '#d32f2f' }}>
              Rechazar
            </button>
          </div>
        </div>
      ))}

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
                            <button className="btn btn-warning" onClick={onIssue} style={{ padding: '8px', fontSize: '0.9rem' }}>Solicitar Reemplazo al Admin</button>
                          </>
                        )}
                        {status === "CONFIRMED" && <div style={{ color: '#4caf50', fontWeight: 'bold', textAlign: 'center' }}>✓ Confirmado</div>}
                        {status === "CHANGE_REQUESTED" && <div style={{ color: '#ff9800', fontWeight: 'bold', textAlign: 'center' }}>🔄 Solicitud enviada al Admin</div>}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button className="btn btn-outline" onClick={() => onFutureIssue(shiftInfo.date, shiftInfo.shift)} style={{ padding: '8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                          <span>🤝</span> Proponer Trueque a Compañero
                        </button>
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

function AdminView({ schedule, statuses, activityLog, resetRequests, futureRequests, approvedSwaps, onChangeAssignment, onResetPassword, onDismissFutureRequest }: { 
  schedule: any, statuses: Record<string, Status>, activityLog: ActivityEntry[], resetRequests: string[], futureRequests: FutureChangeRequest[], approvedSwaps: ApprovedSwap[], onChangeAssignment: (member: string) => void, onResetPassword: (member: string) => void, onDismissFutureRequest: (id: string) => void 
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

      {approvedSwaps.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ color: '#4caf50', borderBottom: '2px solid #4caf50', paddingBottom: '8px', marginBottom: '16px' }}>
            Trueques Automatizados P2P
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {approvedSwaps.map((swap, idx) => (
              <div key={idx} className="glass-card" style={{ border: '1px solid #4caf50', padding: '12px', fontSize: '0.9rem' }}>
                <span style={{ color: '#4caf50', fontWeight: 'bold' }}>{swap.user1}</span> cambió con <span style={{ color: '#4caf50', fontWeight: 'bold' }}>{swap.user2}</span><br/>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({formatDate(swap.date1)} ↔ {formatDate(swap.date2)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

