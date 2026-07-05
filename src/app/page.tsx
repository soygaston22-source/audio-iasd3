"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { getScheduleForDate, TEAM } from "@/lib/rotation";
import { db, storage } from "@/lib/firebase";
import { collection, doc, onSnapshot, setDoc, updateDoc, query, orderBy, limit, addDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

type Role = "ADMIN" | "USER" | null;
type Status = "PENDING" | "CONFIRMED" | "ISSUE" | "CHANGE_REQUESTED";

interface PendingSwap {
  id: string;
  fromUser: string;
  fromDate: string;
  fromShift: string;
  toUser: string;
  toDate: string;
  toShift: string;
}

interface ApprovedSwap {
  id: string;
  user1: string;
  date1: string;
  user2: string;
  date2: string;
}

interface FutureChangeRequest {
  id: string;
  user: string;
  date: string;
  shift: string;
  targetUser: string;
  targetDate: string;
  targetShift: string;
  reason: string;
}

export interface SpecialShift {
  id: string;
  title: string;
  date: string;
  members: string[];
}

interface Announcement {
  id?: string;
  title?: string;
  text: string;
  author?: string;
  timestamp?: any;
  fileUrl?: string;
  fileName?: string;
}

interface UserState {
  name: string;
  role: Role;
}

interface ActivityEntry {
  id: string;
  date: string;
  action: string;
}

const DEFAULT_USER_PASSWORD = "123";

// Helper for formatting dates
const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
};

async function sendPushNotification(user: string, title: string, body: string) {
  try {
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, title, body })
    });
  } catch (e) {
    console.error("Push Error", e);
  }
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  
  // App state
  const [currentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<any>(null);
  
  // Firebase sync states
  const [userStatuses, setUserStatuses] = useState<Record<string, Status>>({});
  const [userPasswords, setUserPasswords] = useState<Record<string, string>>({});
  const [userNotifications, setUserNotifications] = useState<Record<string, string[]>>({});
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [resetRequests, setResetRequests] = useState<string[]>([]);
  
  // Advanced features state
  const [pendingSwaps, setPendingSwaps] = useState<PendingSwap[]>([]);
  const [approvedSwaps, setApprovedSwaps] = useState<ApprovedSwap[]>([]);
  const [specialShifts, setSpecialShifts] = useState<SpecialShift[]>([]);
  const [futureRequests, setFutureRequests] = useState<FutureChangeRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

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
        if (data.pendingSwaps) setPendingSwaps(data.pendingSwaps);
        if (data.approvedSwaps) setApprovedSwaps(data.approvedSwaps);
        if (data.specialShifts) setSpecialShifts(data.specialShifts);
        if (data.futureRequests) setFutureRequests(data.futureRequests);
      } else {
        // Init global state if not exists
        const sched = getScheduleForDate(new Date(), [], 0);
        setDoc(doc(db, "app_state", "global"), {
          schedule: sched,
          resetRequests: [],
          pendingSwaps: [],
          approvedSwaps: [],
          specialShifts: [],
          futureRequests: []
        });
        setSchedule(sched);
      }
    });

    // 2. Listen to announcements
    const qAnnouncements = query(collection(db, "announcements"), orderBy("timestamp", "desc"));
    const unsubAnnouncements = onSnapshot(qAnnouncements, (snap) => {
      const anns: Announcement[] = [];
      snap.forEach(docSnap => {
        anns.push({ id: docSnap.id, ...docSnap.data() } as Announcement);
      });
      setAnnouncements(anns);
    });

    // 3. Listen to users
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

    // 4. Listen to activity logs
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

    setTimeout(() => setLoading(false), 1500);

    return () => {
      unsubGlobal();
      unsubAnnouncements();
      unsubUsers();
      unsubLogs();
    };
  }, []);

  const handleResetRequest = async (name: string) => {
    if (!resetRequests.includes(name)) {
      const newReqs = [...resetRequests, name];
      await updateDoc(doc(db, "app_state", "global"), { resetRequests: newReqs });
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
    addLog(`✅ ${currentUser.name} ha confirmado su asistencia.`);
    alert("¡Asistencia confirmada!");
  };

  const handleIssue = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { status: "CHANGE_REQUESTED" }, { merge: true });
    addLog(`🔄 ${currentUser.name} ha solicitado un cambio de turno.`);
    alert("Notificación enviada al Administrador para solicitar un cambio.");
  };

  const handleFutureIssue = async (date: string, shift: string, targetUser: string, targetDate: string, targetShift: string) => {
    if (!currentUser) return;
    const reason = prompt("Describe brevemente el motivo del cambio o requerimiento especial:");
    if (!reason) return;
    
    const newReq: FutureChangeRequest = {
      id: Date.now().toString(),
      user: currentUser.name,
      date,
      shift,
      targetUser,
      targetDate,
      targetShift,
      reason
    };
    
    await updateDoc(doc(db, "app_state", "global"), {
      futureRequests: [...futureRequests, newReq]
    });
    addLog(`📝 ${currentUser.name} envió una solicitud futura para el ${formatDate(date)}.`);
    alert("Solicitud futura enviada al Administrador.");
  };

  const handleProposeSwap = async (swap: PendingSwap) => {
    await updateDoc(doc(db, "app_state", "global"), {
      pendingSwaps: [...pendingSwaps, swap]
    });
    
    const targetNotifs = userNotifications[swap.toUser] || [];
    await setDoc(doc(db, "users", swap.toUser), { 
      notifications: [...targetNotifs, `¡${swap.fromUser} te ha propuesto un trueque de turnos!`] 
    }, { merge: true });
    
    sendPushNotification(swap.toUser, "¡Propuesta de Trueque!", `${swap.fromUser} te ha propuesto intercambiar turnos.`);
    addLog(`🤝 ${swap.fromUser} propuso un trueque a ${swap.toUser}.`);
    alert("Propuesta de trueque enviada a " + swap.toUser);
  };

  const handleAcceptSwap = async (swap: PendingSwap) => {
    const updatedPending = pendingSwaps.filter(s => s.id !== swap.id);
    const newApproved: ApprovedSwap = {
      id: Date.now().toString(),
      user1: swap.fromUser,
      date1: swap.fromDate,
      user2: swap.toUser,
      date2: swap.toDate
    };
    
    await updateDoc(doc(db, "app_state", "global"), {
      pendingSwaps: updatedPending,
      approvedSwaps: [...approvedSwaps, newApproved]
    });
    
    const targetNotifs = userNotifications[swap.fromUser] || [];
    await setDoc(doc(db, "users", swap.fromUser), { 
      notifications: [...targetNotifs, `¡${swap.toUser} ha ACEPTADO tu propuesta de trueque!`] 
    }, { merge: true });
    
    sendPushNotification(swap.fromUser, "¡Trueque Aceptado!", `${swap.toUser} aceptó tu propuesta de trueque.`);
    addLog(`✅ ${swap.toUser} aceptó el trueque de ${swap.fromUser}.`);
    alert("¡Trueque aceptado y registrado en el sistema P2P!");
  };

  const handleRejectSwap = async (swap: PendingSwap) => {
    const updatedPending = pendingSwaps.filter(s => s.id !== swap.id);
    await updateDoc(doc(db, "app_state", "global"), { pendingSwaps: updatedPending });
    
    const targetNotifs = userNotifications[swap.fromUser] || [];
    await setDoc(doc(db, "users", swap.fromUser), { 
      notifications: [...targetNotifs, `Lo sentimos, ${swap.toUser} ha rechazado tu propuesta de trueque.`] 
    }, { merge: true });
    
    alert("Trueque rechazado.");
  };

  const handleClearNotifications = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { notifications: [] }, { merge: true });
  };

  const handleAdminChange = async (memberToReplace: string) => {
    const newMember = prompt("Ingrese el nombre del reemplazo:");
    if (!newMember) return;
    
    addLog(`🛠️ Administrador cambió a ${memberToReplace} por ${newMember}.`);
    
    if (schedule) {
      const morning = schedule.morning.map((m: string) => m === memberToReplace ? newMember : m);
      const afternoon = schedule.afternoon.map((m: string) => m === memberToReplace ? newMember : m);
      await updateDoc(doc(db, "app_state", "global"), { 
        schedule: { ...schedule, morning, afternoon } 
      });
    }
    
    await setDoc(doc(db, "users", memberToReplace), { status: "PENDING" }, { merge: true });
    await setDoc(doc(db, "users", newMember), { status: "PENDING" }, { merge: true });
  };

  const handleAdminRejectChange = async () => {};

  const handleResetPassword = async (userName: string) => {
    await setDoc(doc(db, "users", userName), { password: DEFAULT_USER_PASSWORD }, { merge: true });
    const newReqs = resetRequests.filter(name => name !== userName);
    await updateDoc(doc(db, "app_state", "global"), { resetRequests: newReqs });
    addLog(`🔓 Administrador restableció la contraseña de ${userName}.`);
    alert(`La contraseña de ${userName} ha sido restablecida a "${DEFAULT_USER_PASSWORD}".`);
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
          <div className="responsive-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {TEAM.map(member => (
              <button key={member} className="btn btn-outline" onClick={() => handleLogin(member, "USER")} style={{ padding: '8px' }}>
                {member}
              </button>
            ))}
          </div>
          
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
            specialShifts={specialShifts}
            announcements={announcements}
            onConfirm={handleConfirm}
            onIssue={handleIssue}
            onFutureIssue={handleFutureIssue}
            onChangePassword={handleChangePassword}
            onClearNotifications={handleClearNotifications}
            onAcceptSwap={handleAcceptSwap}
            onRejectSwap={handleRejectSwap}
            onProposeSwap={handleProposeSwap}
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
            specialShifts={specialShifts}
            announcements={announcements}
            onChangeAssignment={handleAdminChange}
            onResetPassword={handleResetPassword}
          />
        )}
      </main>
    </>
  );
}

function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, specialShifts, announcements, onConfirm, onIssue, onFutureIssue, onChangePassword, onClearNotifications, onAcceptSwap, onRejectSwap, onProposeSwap }: { 
  currentDate: Date, schedule: any, userName: string, status: Status, notifications: string[], pendingSwaps: PendingSwap[], approvedSwaps: ApprovedSwap[], specialShifts: SpecialShift[], announcements: Announcement[], onConfirm: () => void, onIssue: () => void, onFutureIssue: (d:string, s:string, tU:string, tD:string, tS:string) => void, onChangePassword: () => void, onClearNotifications: () => void, onAcceptSwap: (swap: PendingSwap) => void, onRejectSwap: (swap: PendingSwap) => void, onProposeSwap: (swap: PendingSwap) => void
}) {
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapTargetUser, setSwapTargetUser] = useState("");
  const [swapTargetDate, setSwapTargetDate] = useState("");

  const isMorning = schedule.morning.includes(userName);
  const isAfternoon = schedule.afternoon.includes(userName);
  const hasShift = isMorning || isAfternoon;

  let shiftName = "Ninguno";
  let partner = "";
  if (isMorning) {
    shiftName = "Mañana";
    partner = schedule.morning.find((m: string) => m !== userName) || "Nadie";
  } else if (isAfternoon) {
    shiftName = "Tarde";
    partner = schedule.afternoon.find((m: string) => m !== userName) || "Nadie";
  }

  const futureShifts: { date: string, shift: string, isCurrent: boolean }[] = [];
  for (let i = 1; i <= 4; i++) {
    const futureDate = new Date(currentDate.getTime() + (i * 7 * 86400000));
    const sched = getScheduleForDate(futureDate, approvedSwaps, 0);
    if (sched.morning.includes(userName)) {
      futureShifts.push({ date: sched.date, shift: 'Mañana', isCurrent: false });
    }
    if (sched.afternoon.includes(userName)) {
      futureShifts.push({ date: sched.date, shift: 'Tarde', isCurrent: false });
    }
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h4 style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '1px' }}>
          {formatDate(currentDate.toISOString().split('T')[0])}
        </h4>
        <h3 style={{ textShadow: '0 2px 4px rgba(255,255,255,0.5)' }}>Hola, {userName}</h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '10px' }}>
          <button onClick={onChangePassword} style={{ background: 'none', border: 'none', color: 'var(--primary-red)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}>
            Cambiar clave
          </button>
        </div>
      </div>

      <div className="responsive-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {notifications.length > 0 && (
            <div className="glass-card" style={{ backgroundColor: 'rgba(239, 108, 0, 0.1)', border: '1px solid rgba(239, 108, 0, 0.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef6c00', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>🔔</span>
                <strong style={{ fontSize: '1.1rem' }}>Nueva Notificación</strong>
              </div>
              <ul style={{ paddingLeft: '20px', margin: '0 0 16px 0', color: 'var(--glass-text)' }}>
                {notifications.map((msg, idx) => <li key={idx} style={{ marginBottom: '8px' }}>{msg}</li>)}
              </ul>
              <button className="btn btn-primary" onClick={onClearNotifications} style={{ width: '100%', backgroundColor: '#ef6c00' }}>
                Entendido
              </button>
            </div>
          )}

          {pendingSwaps.map(swap => (
            <div key={swap.id} className="glass-card" style={{ backgroundColor: 'rgba(46, 125, 50, 0.1)', border: '2px solid #4caf50' }}>
              <h3 style={{ color: '#4caf50', marginBottom: '12px' }}>🤝 ¡Propuesta de Trueque!</h3>
              <p style={{ marginBottom: '16px', lineHeight: '1.5' }}>
                <strong>{swap.fromUser}</strong> te propone intercambiar su turno del <strong>{formatDate(swap.fromDate)}</strong> a cambio de tu turno del <strong>{formatDate(swap.toDate)}</strong>.
              </p>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-success" onClick={() => onAcceptSwap(swap)} style={{ flex: 1 }}>Aceptar</button>
                <button className="btn btn-outline" onClick={() => onRejectSwap(swap)} style={{ flex: 1, borderColor: '#d32f2f', color: '#d32f2f' }}>Rechazar</button>
              </div>
            </div>
          ))}

          {specialShifts.filter(ss => ss.members.includes(userName)).length > 0 && (
            <div>
              <h4 style={{ marginBottom: '12px', fontSize: '1.1rem', color: '#ff9800' }}>⭐ Mis Turnos Especiales</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {specialShifts.filter(ss => ss.members.includes(userName)).map((shift) => (
                  <div key={shift.id} className="glass-card" style={{ border: '1px solid rgba(255, 152, 0, 0.5)', background: 'rgba(255, 152, 0, 0.1)' }}>
                    <h3 style={{ color: '#ff9800', marginBottom: '8px' }}>{shift.title}</h3>
                    <p style={{ fontWeight: 'bold' }}>{formatDate(shift.date)}</p>
                    <p style={{ fontSize: '0.9rem', marginTop: '8px', color: 'var(--text-muted)' }}>
                      Junto a: {shift.members.filter(m => m !== userName).join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h4 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>Mis Próximos Turnos</h4>
            {hasShift && (
              <div className="glass-card" style={{ marginBottom: '16px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, backgroundColor: 'rgba(164,52,49,0.2)', padding: '4px 12px', borderBottomLeftRadius: '12px', fontSize: '0.8rem', color: 'var(--primary-red)', fontWeight: 'bold' }}>Esta Semana</div>
                <h4 style={{ color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', fontSize: '0.85rem' }}>Fecha</h4>
                <h2 style={{ color: 'var(--primary-red)', marginBottom: '4px', fontSize: '1.5rem', textTransform: 'capitalize' }}>{formatDate(schedule.date)}</h2>
                <p style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '16px' }}>Turno {shiftName}</p>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {status === "PENDING" && (
                      <>
                        <button className="btn btn-success" onClick={onConfirm}>Confirmar Asistencia</button>
                        <button className="btn btn-warning" onClick={onIssue}>Solicitar Reemplazo</button>
                      </>
                    )}
                    {status === "CONFIRMED" && <div style={{ color: '#4caf50', fontWeight: 'bold', textAlign: 'center' }}>✓ Confirmado</div>}
                    {status === "CHANGE_REQUESTED" && <div style={{ color: '#ff9800', fontWeight: 'bold', textAlign: 'center' }}>🔄 Solicitud enviada al Admin</div>}
                  </div>
                </div>
              </div>
            )}
            
            {futureShifts.map((fs, idx) => (
              <div key={idx} className="glass-card" style={{ marginBottom: '16px' }}>
                <h4 style={{ color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', fontSize: '0.85rem' }}>Fecha</h4>
                <h2 style={{ color: 'var(--primary-red)', marginBottom: '4px', fontSize: '1.5rem', textTransform: 'capitalize' }}>{formatDate(fs.date)}</h2>
                <p style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '16px' }}>Turno {fs.shift}</p>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                  <button className="btn btn-outline" onClick={() => setSwapModalOpen(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span>🤝</span> Proponer Trueque a Compañero
                  </button>
                </div>
              </div>
            ))}
            
            {!hasShift && futureShifts.length === 0 && (
              <div className="glass-card" style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '1.1rem' }}>No tienes turnos asignados próximamente.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {swapModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '500px', backgroundColor: '#1a1a1a' }}>
            <h3 style={{ marginBottom: '16px' }}>Proponer Trueque de Turnos</h3>
            <p style={{ marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Selecciona a un compañero para enviarle una propuesta de intercambio de turnos automática.</p>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Compañero:</label>
              <select value={swapTargetUser} onChange={(e) => setSwapTargetUser(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid var(--glass-border)' }}>
                <option value="">-- Seleccionar --</option>
                {TEAM.filter(m => m !== userName).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            
            <button className="btn btn-primary" onClick={() => {
              if(!swapTargetUser) return alert("Selecciona un compañero");
              onProposeSwap({
                id: Date.now().toString(),
                fromUser: userName,
                fromDate: hasShift ? schedule.date : (futureShifts[0]?.date || ""),
                fromShift: shiftName !== "Ninguno" ? shiftName : (futureShifts[0]?.shift || ""),
                toUser: swapTargetUser,
                toDate: "Fecha futura de " + swapTargetUser,
                toShift: "Turno de " + swapTargetUser
              });
              setSwapModalOpen(false);
            }} style={{ width: '100%', marginBottom: '12px' }}>
              Enviar Propuesta a {swapTargetUser || "..."}
            </button>
            <button className="btn btn-outline" onClick={() => setSwapModalOpen(false)} style={{ width: '100%' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Sección de Novedades */}
      <div style={{ marginTop: '24px' }}>
        <h4 style={{ marginBottom: '16px', fontSize: '1.2rem', color: 'var(--primary-red)' }}>📢 Novedades y Avisos</h4>
        {announcements.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>No hay avisos recientes.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {announcements.map((ann, idx) => (
              <div key={ann.id || idx} className="glass-card" style={{ padding: '20px' }}>
                <h4 style={{ color: 'var(--primary-red)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>📢 {ann.title || "Aviso"}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                    {ann.timestamp?.seconds ? new Date(ann.timestamp.seconds * 1000).toLocaleDateString() : 'Reciente'}
                  </span>
                </h4>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '1.05rem', color: 'var(--glass-text)' }}>
                  {ann.text}
                </p>
                {ann.fileUrl && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--glass-border)' }}>
                    <a 
                      href={ann.fileUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="btn btn-outline"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', textDecoration: 'none', color: 'var(--primary-red)', borderColor: 'var(--primary-red)' }}
                    >
                      📎 Ver Archivo Adjunto ({ann.fileName})
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminView({ schedule, statuses, activityLog, resetRequests, futureRequests, approvedSwaps, specialShifts, announcements, onChangeAssignment, onResetPassword }: { 
  schedule: any, statuses: Record<string, Status>, activityLog: ActivityEntry[], resetRequests: string[], futureRequests: FutureChangeRequest[], approvedSwaps: ApprovedSwap[], specialShifts: SpecialShift[], announcements: Announcement[], onChangeAssignment: (member: string) => void, onResetPassword: (member: string) => void 
}) {
  const [newsTitle, setNewsTitle] = useState("");
  const [newsText, setNewsText] = useState("");
  const [newsFile, setNewsFile] = useState<File | null>(null);
  const [isUploadingNews, setIsUploadingNews] = useState(false);
  const newsFileInputRef = useRef<HTMLInputElement>(null);

  const [specialShiftTitle, setSpecialShiftTitle] = useState("");
  const [specialShiftDate, setSpecialShiftDate] = useState("");
  const [specialShiftMembers, setSpecialShiftMembers] = useState<string[]>([]);
  const [isCreatingSpecial, setIsCreatingSpecial] = useState(false);

  const handleToggleMember = (member: string) => {
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
      const newShift: SpecialShift = {
        id: Date.now().toString(),
        title: specialShiftTitle.trim(),
        date: specialShiftDate,
        members: specialShiftMembers
      };
      await updateDoc(doc(db, "app_state", "global"), {
        specialShifts: [...specialShifts, newShift]
      });
      setSpecialShiftTitle("");
      setSpecialShiftDate("");
      setSpecialShiftMembers([]);
      alert("Turno Especial creado con éxito.");
      
      specialShiftMembers.forEach(member => {
        sendPushNotification(member, `⭐ Nuevo Turno Especial`, `Has sido asignado a: ${newShift.title} el ${formatDate(newShift.date)}`);
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

  const handlePostAnnouncement = async () => {
    if (!newsTitle.trim() || !newsText.trim()) {
      alert("Debes escribir un título y un texto para la novedad.");
      return;
    }
    
    setIsUploadingNews(true);
    try {
      let fileUrl = "";
      let fileName = "";
      
      if (newsFile) {
        const storageRef = ref(storage, `announcements/${Date.now()}_${newsFile.name}`);
        const snapshot = await uploadBytes(storageRef, newsFile);
        fileUrl = await getDownloadURL(snapshot.ref);
        fileName = newsFile.name;
      }
      
      await addDoc(collection(db, "announcements"), {
        title: newsTitle.trim(),
        text: newsText.trim(),
        author: "Administrador",
        timestamp: serverTimestamp(),
        fileUrl,
        fileName
      });
      
      setNewsTitle("");
      setNewsText("");
      setNewsFile(null);
      alert("Novedad publicada con éxito.");
      
      TEAM.forEach(member => {
        sendPushNotification(member, `📢 Nuevo Aviso: ${newsTitle.trim()}`, "Revisa la aplicación para ver los detalles.");
      });
      
    } catch (e: any) {
      alert("Error al publicar la novedad: " + e.message);
    } finally {
      setIsUploadingNews(false);
    }
  };
  
  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar esta novedad?")) return;
    await deleteDoc(doc(db, "announcements", id));
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h3 style={{ textShadow: '0 2px 4px rgba(255,255,255,0.5)' }}>Panel de Administrador</h3>
      </div>

      <div className="responsive-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: 'var(--primary-red)', borderBottom: '2px solid var(--primary-red)', paddingBottom: '8px', marginBottom: '16px' }}>
              📢 Publicar Novedad o Archivo
            </h3>
            
            <div className="glass-card" style={{ padding: '16px' }}>
              <input 
                type="text" 
                placeholder="Título del anuncio..." 
                value={newsTitle}
                onChange={(e) => setNewsTitle(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', fontSize: '1rem', marginBottom: '12px' }}
              />
              <textarea 
                placeholder="Escribe los detalles aquí..." 
                value={newsText}
                onChange={(e) => setNewsText(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', minHeight: '100px', fontSize: '1rem', fontFamily: 'inherit', marginBottom: '12px' }}
              />
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  ref={newsFileInputRef}
                  onChange={(e) => setNewsFile(e.target.files?.[0] || null)}
                  style={{ display: 'none' }}
                />
                <button 
                  className="btn btn-outline"
                  onClick={() => newsFileInputRef.current?.click()}
                  style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                  📎 {newsFile ? newsFile.name : 'Adjuntar Archivo'}
                </button>
                <button 
                  className="btn"
                  onClick={handlePostAnnouncement}
                  disabled={isUploadingNews}
                  style={{ flex: 1 }}
                >
                  {isUploadingNews ? "Subiendo..." : "Publicar"}
                </button>
              </div>
            </div>

            {announcements.length > 0 && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {announcements.map((ann) => (
                  <div key={ann.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <strong style={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ann.title}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {ann.timestamp?.seconds ? new Date(ann.timestamp.seconds * 1000).toLocaleDateString() : 'Reciente'}
                      </span>
                    </div>
                    <button 
                      onClick={() => ann.id && handleDeleteAnnouncement(ann.id)}
                      style={{ background: 'none', border: 'none', color: '#d32f2f', fontSize: '1.2rem', cursor: 'pointer', padding: '8px' }}
                      title="Eliminar Novedad"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#ff9800', borderBottom: '2px solid #ff9800', paddingBottom: '8px', marginBottom: '16px' }}>
              ⭐ Gestión de Turnos Especiales
            </h3>
            
            <div className="glass-card" style={{ padding: '16px', marginBottom: '16px', border: '1px solid rgba(255, 152, 0, 0.5)' }}>
              <h4 style={{ marginBottom: '12px' }}>Crear Nuevo Turno</h4>
              <input 
                type="text" 
                placeholder="Título (ej: Campaña Evangelística)" 
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
                      onClick={() => handleToggleMember(member)}
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
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ borderBottom: '2px solid var(--primary-red)', paddingBottom: '8px', marginBottom: '16px' }}>
              Turno Mañana ({formatDate(schedule.date)})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {schedule.morning.map((member: string) => {
                const status = statuses[member] || 'PENDING';
                let statusColor = '#9e9e9e'; let statusText = 'Pendiente';
                if (status === 'CONFIRMED') { statusColor = '#2e7d32'; statusText = 'Confirmado'; }
                if (status === 'CHANGE_REQUESTED') { statusColor = '#ef6c00'; statusText = 'CAMBIO SOLICITADO'; }
                return (
                  <div key={member} className="glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '1.1rem' }}>{member}</strong>
                      <span style={{ color: statusColor, fontSize: '0.85rem', fontWeight: 'bold' }}>{statusText}</span>
                    </div>
                    <button onClick={() => onChangeAssignment(member)} className="btn btn-outline" style={{ padding: '8px 12px' }}>Cambiar</button>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ borderBottom: '2px solid var(--primary-red)', paddingBottom: '8px', marginBottom: '16px' }}>
              Turno Tarde ({formatDate(schedule.date)})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {schedule.afternoon.map((member: string) => {
                const status = statuses[member] || 'PENDING';
                let statusColor = '#9e9e9e'; let statusText = 'Pendiente';
                if (status === 'CONFIRMED') { statusColor = '#2e7d32'; statusText = 'Confirmado'; }
                if (status === 'CHANGE_REQUESTED') { statusColor = '#ef6c00'; statusText = 'CAMBIO SOLICITADO'; }
                return (
                  <div key={member} className="glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '1.1rem' }}>{member}</strong>
                      <span style={{ color: statusColor, fontSize: '0.85rem', fontWeight: 'bold' }}>{statusText}</span>
                    </div>
                    <button onClick={() => onChangeAssignment(member)} className="btn btn-outline" style={{ padding: '8px 12px' }}>Cambiar</button>
                  </div>
                );
              })}
            </div>
          </div>

          {resetRequests.length > 0 && (
            <div className="glass-card" style={{ backgroundColor: 'rgba(211, 47, 47, 0.1)', border: '1px solid rgba(211, 47, 47, 0.3)', marginBottom: '24px' }}>
              <h3 style={{ color: '#d32f2f', marginBottom: '12px' }}>⚠ Solicitudes de Contraseña</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {resetRequests.map(req => (
                  <div key={req} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.5)', borderRadius: '8px' }}>
                    <strong style={{ color: '#d32f2f' }}>{req}</strong>
                    <button onClick={() => onResetPassword(req)} style={{ padding: '6px 12px', background: '#d32f2f', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                      Restablecer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
      </div>
    </div>
  );
}
