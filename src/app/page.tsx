"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { getScheduleForDate, TEAM, getAllFutureShiftsForUser, formatDate, ApprovedSwap } from "@/lib/rotation";
import { db } from "@/lib/firebase";
import { collection, doc, onSnapshot, setDoc, query, orderBy, limit, addDoc, serverTimestamp, getDoc, deleteDoc, increment, where, getDocs } from "firebase/firestore";

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

export interface Announcement {
  id: string;
  text: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  timestamp: any;
  author: string;
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
const PUBLIC_VAPID_KEY = "BGvE_ospDOppl7nBqByjIwlnMVUJXkJkfs6KcYcomTAhA7TYNtSC3QvTZLcBhebKPMd0fL38820ZW2LRLShInOA";

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const sendPushNotification = async (targetUser: string, title: string, body: string) => {
  try {
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetUser, title, body })
    });
  } catch (err) {
    console.error("Error sending push request:", err);
  }
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  
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
  const [userUnreadCounts, setUserUnreadCounts] = useState<Record<string, Record<string, number>>>({});
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [resetRequests, setResetRequests] = useState<string[]>([]);
  const [futureRequests, setFutureRequests] = useState<FutureChangeRequest[]>([]);
  const [pendingSwaps, setPendingSwaps] = useState<PendingSwap[]>([]);
  const [approvedSwaps, setApprovedSwaps] = useState<ApprovedSwap[]>([]);
  const [seedOffset, setSeedOffset] = useState<number>(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [youtubeLiveUrl, setYoutubeLiveUrl] = useState<string>("");

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
        if (data.seedOffset !== undefined) setSeedOffset(data.seedOffset);
        if (data.youtubeLiveUrl !== undefined) setYoutubeLiveUrl(data.youtubeLiveUrl);
      } else {
        // Init global state if not exists
        const sched = getScheduleForDate(new Date(), [], 0);
        setDoc(doc(db, "app_state", "global"), {
          schedule: sched,
          resetRequests: [],
          futureRequests: [],
          pendingSwaps: [],
          approvedSwaps: [],
          seedOffset: 0,
          youtubeLiveUrl: ""
        });
        setSchedule(sched);
      }
    });

    // 2. Listen to users
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const statuses: Record<string, Status> = {};
      const passwords: Record<string, string> = {};
      const notifications: Record<string, string[]> = {};
      const unreads: Record<string, Record<string, number>> = {};
      
      snap.forEach(docSnap => {
        const data = docSnap.data();
        statuses[docSnap.id] = data.status || "PENDING";
        passwords[docSnap.id] = data.password || DEFAULT_USER_PASSWORD;
        notifications[docSnap.id] = data.notifications || [];
        unreads[docSnap.id] = data.unreadCounts || {};
      });
      
      setUserStatuses(statuses);
      setUserPasswords(passwords);
      setUserNotifications(notifications);
      setUserUnreadCounts(unreads);
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

    // 4. Listen to announcements
    const qAnnouncements = query(collection(db, "announcements"), orderBy("timestamp", "desc"));
    const unsubAnnouncements = onSnapshot(qAnnouncements, (snap) => {
      const anns: Announcement[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        anns.push({
          id: docSnap.id,
          text: data.text,
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileType: data.fileType,
          timestamp: data.timestamp,
          author: data.author
        });
      });
      setAnnouncements(anns);
    });

    setTimeout(() => setLoading(false), 2000);

    return () => {
      unsubGlobal();
      unsubUsers();
      unsubLogs();
      unsubAnnouncements();
    };
  }, []);

  useEffect(() => {
    // Check if the current global schedule is outdated and roll over to the new week.
    if (schedule) {
      const today = new Date();
      if (today.getDay() === 0) today.setDate(today.getDate() + 1); // Sunday belongs to next week's schedule
      const expectedSched = getScheduleForDate(today, approvedSwaps, seedOffset);

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

  useEffect(() => {
    if (currentUser?.role !== "ADMIN") return;

    const cleanOldMessages = async () => {
      try {
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
        
        const qOld = query(collection(db, "messages"), where("timestamp", "<", fifteenDaysAgo));
        const snap = await getDocs(qOld);
        
        let deletedCount = 0;
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (!data.pinned) {
            deleteDoc(doc(db, "messages", docSnap.id)).catch(e => console.error("Error eliminando mensaje viejo:", e));
            deletedCount++;
          }
        });
        if (deletedCount > 0) {
          console.log(`Sistema automático eliminó ${deletedCount} mensajes antiguos (más de 15 días).`);
        }
      } catch (err) {
        console.error("Error ejecutando limpieza de chat:", err);
      }
    };

    cleanOldMessages();
  }, [currentUser]);

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
    if (confirm("¿Deseas avisar de tu asistencia al grupo de WhatsApp?")) {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`✅ ¡Hola! Soy ${currentUser.name} y he confirmado mi asistencia para mi turno de este sábado en la App de Audio IASD.`)}`, '_blank');
    }
  };

  const handleIssue = async () => {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.name), { status: "CHANGE_REQUESTED" }, { merge: true });
    addLog(`🔄 ${currentUser.name} ha solicitado un cambio de turno para esta semana.`);
    alert("Notificación enviada al Administrador. Quedará registrado.");
    if (confirm("¿Deseas avisar al grupo de WhatsApp que necesitas un reemplazo urgente?")) {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`⚠️ ¡Hola chicos! Soy ${currentUser.name}. Necesito un reemplazo urgente para mi turno de este sábado. Por favor revisen la App de Audio IASD.`)}`, '_blank');
    }
  };

  const handleFutureIssue = async (shiftDate: string, shiftName: string, targetUser: string, targetDate: string, targetShift: string) => {
    if (!currentUser) return;
    
    if (confirm(`Estás a punto de proponer cambiar tu turno del ${formatDate(shiftDate)} por el turno del ${formatDate(targetDate)} de ${targetUser}. ¿Confirmar envío de propuesta?`)) {
      const newSwap: PendingSwap = {
        id: Math.random().toString(36).substring(2, 9),
        fromUser: currentUser.name,
        fromDate: shiftDate,
        fromShift: shiftName,
        toUser: targetUser,
        toDate: targetDate,
        toShift: targetShift
      };

      const newPending = [...pendingSwaps, newSwap];
      await setDoc(doc(db, "app_state", "global"), { pendingSwaps: newPending }, { merge: true });
      addLog(`📩 ${currentUser.name} le propuso un trueque de turnos a ${targetUser}.`);
      alert(`¡Propuesta enviada a ${targetUser}! Cuando él inicie sesión podrá aceptarla o rechazarla.`);
      sendPushNotification(targetUser, "¡Propuesta de Trueque!", `${currentUser.name} te propone cambiar turnos.`);
      if (confirm(`¿Deseas avisarle de tu propuesta por WhatsApp? (Puedes mandarlo al grupo o a su chat personal)`)) {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`🤝 ¡Hola ${targetUser}! Te he enviado una propuesta de trueque de turnos en la App de Audio IASD. Te ofrezco mi turno del ${formatDate(shiftDate)} a cambio de tu turno del ${formatDate(targetDate)}. ¡Entra a la App para aceptarla o rechazarla!`)}`, '_blank');
      }
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
    sendPushNotification(swap.fromUser, "Trueque Aceptado", `${swap.toUser} ha aceptado tu propuesta de cambio de turno.`);
    if (confirm(`¿Deseas avisarle por WhatsApp a ${swap.fromUser} que has aceptado el trueque?`)) {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`✅ ¡Hola ${swap.fromUser}! Ya he aceptado tu propuesta de trueque en la App de Audio IASD. ¡El calendario ya está actualizado automáticamente! Trato hecho.`)}`, '_blank');
    }
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
    sendPushNotification(swap.fromUser, "Trueque Rechazado", `${swap.toUser} ha rechazado tu propuesta de cambio de turno.`);
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
    sendPushNotification(newMember, "¡Nuevo Turno Asignado!", `El Administrador te ha asignado como reemplazo para este sábado.`);
    
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

  const handleAdminRejectChange = async (member: string) => {
    if (!confirm(`¿Estás seguro de rechazar la solicitud de cambio de ${member}?`)) return;
    
    await setDoc(doc(db, "users", member), { status: "PENDING" }, { merge: true });
    
    const memberDoc = await getDoc(doc(db, "users", member));
    const existingNotifs = memberDoc.exists() && memberDoc.data().notifications ? memberDoc.data().notifications : [];
    await setDoc(doc(db, "users", member), { 
      notifications: [...existingNotifs, `El Administrador ha rechazado tu solicitud de reemplazo para este sábado. Debes asistir o buscar un trueque.`] 
    }, { merge: true });

    addLog(`❌ Administrador rechazó la solicitud de cambio de ${member}.`);
    alert(`Solicitud rechazada. Se ha notificado a ${member}.`);
    sendPushNotification(member, "Solicitud Rechazada", `El Administrador ha denegado tu solicitud de reemplazo para este sábado.`);
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

  const handleRejectFutureRequest = async (req: FutureChangeRequest) => {
    if (!confirm(`¿Estás seguro de rechazar la solicitud futura de ${req.user}?`)) return;

    const newReqs = futureRequests.filter(r => r.id !== req.id);
    await setDoc(doc(db, "app_state", "global"), { futureRequests: newReqs }, { merge: true });
    
    const userDoc = await getDoc(doc(db, "users", req.user));
    const existingNotifs = userDoc.exists() && userDoc.data().notifications ? userDoc.data().notifications : [];
    await setDoc(doc(db, "users", req.user), { 
      notifications: [...existingNotifs, `El Administrador ha denegado tu solicitud de cambio para el turno del ${formatDate(req.date)}.`] 
    }, { merge: true });

    addLog(`❌ Administrador denegó la solicitud futura de ${req.user} para el ${req.date}.`);
    alert(`Solicitud denegada. Se ha notificado a ${req.user}.`);
    sendPushNotification(req.user, "Solicitud Futura Rechazada", `El Administrador ha denegado tu solicitud de cambio para el ${req.date}.`);
  };

  const handleRandomReassign = async () => {
    if (!confirm("⚠️ ¡ADVERTENCIA EXTREMA!\n\nEstás a punto de reasignar aleatoriamente TODOS los turnos futuros.\n\nEsto borrará todos los trueques pendientes y confirmaciones actuales.\n\n¿Estás completamente seguro de continuar?")) return;
    
    const newOffset = Math.floor(Math.random() * 1000000);
    const today = new Date();
    if (today.getDay() === 0) today.setDate(today.getDate() + 1);
    
    const newSched = getScheduleForDate(today, [], newOffset);
    
    // Reset all statuses
    TEAM.forEach(member => {
      setDoc(doc(db, "users", member), { status: "PENDING" }, { merge: true });
    });

    await setDoc(doc(db, "app_state", "global"), { 
      seedOffset: newOffset,
      pendingSwaps: [],
      approvedSwaps: [],
      schedule: newSched
    }, { merge: true });

    addLog(`🎲 Administrador ha reasignado aleatoriamente todos los turnos futuros.`);
    alert("¡Éxito! Todos los turnos han sido reasignados aleatoriamente y los trueques han sido limpiados.");
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (confirm("¿Estás seguro de que deseas eliminar este aviso?")) {
      await deleteDoc(doc(db, "announcements", id));
      addLog(`🗑️ Administrador ha eliminado una novedad.`);
    }
  };

  const handleUpdateYoutubeLive = async (url: string) => {
    await setDoc(doc(db, "app_state", "global"), { youtubeLiveUrl: url }, { merge: true });
    alert("URL de YouTube actualizada exitosamente.");
  };

  const [showYoutubePlayer, setShowYoutubePlayer] = useState(false);

  const currentUserUnreads = currentUser ? (userUnreadCounts[currentUser.name] || {}) : {};
  const totalUnreadCount = Object.values(currentUserUnreads).reduce((a, b) => a + b, 0);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {youtubeLiveUrl && (
            <button 
              onClick={() => setShowYoutubePlayer(true)}
              style={{ background: '#ff0000', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer', marginRight: '16px', boxShadow: '0 2px 8px rgba(255,0,0,0.4)', fontSize: '0.9rem' }}
            >
              📺 En Vivo
            </button>
          )}
          {currentUser && (
            <button 
              onClick={() => setChatOpen(true)}
              style={{ background: 'none', border: 'none', fontSize: '1.8rem', cursor: 'pointer', marginRight: '16px', position: 'relative' }}
            >
              💬
              {totalUnreadCount > 0 && (
                <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: 'red', color: 'white', borderRadius: '12px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold', padding: '0 4px', zIndex: 10 }}>
                  {totalUnreadCount}
                </span>
              )}
            </button>
          )}
          <button 
            onClick={() => setCurrentUser(null)}
            style={{ background: 'none', border: 'none', color: 'white', textDecoration: 'underline', cursor: 'pointer', fontSize: '1rem' }}
          >
            Salir
          </button>
        </div>
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
            seedOffset={seedOffset}
            announcements={announcements}
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
            announcements={announcements}
            onChangeAssignment={handleAdminChange}
            onRejectAssignment={handleAdminRejectChange}
            onResetPassword={handleResetPassword}
            onDismissFutureRequest={handleDismissFutureRequest}
            onRejectFutureRequest={handleRejectFutureRequest}
            onRandomReassign={handleRandomReassign}
            onDeleteAnnouncement={handleDeleteAnnouncement}
            youtubeLiveUrl={youtubeLiveUrl}
            onUpdateYoutubeLive={handleUpdateYoutubeLive}
          />
        )}
      </main>

      {showYoutubePlayer && youtubeLiveUrl && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '800px', background: 'var(--glass-bg)', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '16px', background: 'var(--primary-red)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white' }}>
              <h3 style={{ margin: 0 }}>📺 Transmisión en Vivo</h3>
              <button onClick={() => setShowYoutubePlayer(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '16px' }}>
              <iframe 
                src={youtubeLiveUrl.startsWith('UC') ? `https://www.youtube.com/embed/live_stream?channel=${youtubeLiveUrl}` : `https://www.youtube.com/embed/${youtubeLiveUrl.split('v=')[1]?.split('&')[0] || youtubeLiveUrl.split('youtu.be/')[1]?.split('?')[0] || youtubeLiveUrl}`}
                width="100%" 
                height="400px" 
                style={{ border: 'none', borderRadius: '8px' }} 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowFullScreen
              ></iframe>
            </div>
          </div>
        </div>
      )}

      {chatOpen && currentUser && (
        <ChatView currentUser={currentUser} unreadCounts={currentUserUnreads} onClose={() => setChatOpen(false)} />
      )}
    </>
  );
}

function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, seedOffset, announcements, onConfirm, onIssue, onFutureIssue, onChangePassword, onClearNotifications, onAcceptSwap, onRejectSwap }: { 
  currentDate: Date, schedule: any, userName: string, status: Status, notifications: string[], pendingSwaps: PendingSwap[], approvedSwaps: ApprovedSwap[], seedOffset: number, announcements: Announcement[], onConfirm: () => void, onIssue: () => void, onFutureIssue: (date: string, shift: string, targetUser: string, targetDate: string, targetShift: string) => void, onChangePassword: () => void, onClearNotifications: () => void, onAcceptSwap: (swap: PendingSwap) => void, onRejectSwap: (swap: PendingSwap) => void
}) {
  const isSunday = currentDate.getDay() === 0;
  const searchFrom = isSunday ? new Date(currentDate.getTime() + 86400000) : currentDate;
  
  const futureShifts = getAllFutureShiftsForUser(userName, searchFrom, 5, approvedSwaps, seedOffset);
  
  const [swapModalState, setSwapModalState] = useState<{
    shiftDate: string;
    shiftName: string;
    targetUser: string | null;
    targetShifts: { date: string, shift: string }[] | null;
  } | null>(null);

  const handleEnablePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert("Tu dispositivo o navegador no soporta notificaciones push. En iPhone, recuerda 'Agregar a la Pantalla de Inicio' primero.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        // Esperar a que el service worker esté "listo" y activo antes de suscribirse
        const readyRegistration = await navigator.serviceWorker.ready;
        
        // ¡NUEVO! Forzar eliminación de suscripciones viejas (soluciona el error 400/403 en Android)
        const existingSubscription = await readyRegistration.pushManager.getSubscription();
        if (existingSubscription) {
          await existingSubscription.unsubscribe();
        }

        const subscription = await readyRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });
        await setDoc(doc(db, "users", userName), { 
          pushSubscription: JSON.parse(JSON.stringify(subscription))
        }, { merge: true });
        alert("¡Notificaciones Push activadas con éxito! Ahora recibirás alertas como en WhatsApp.");
      } catch (err: any) {
        console.error(err);
        alert("Error al suscribirse: " + err.message);
      }
    } else {
      alert("Permiso de notificaciones denegado por el usuario.");
    }
  };

  const handleTestPush = async () => {
    try {
      const docRef = doc(db, "users", userName);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists() && docSnap.data().pushSubscription) {
        const sub = docSnap.data().pushSubscription;
        const res = await fetch('/api/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: userName, title: "¡Prueba Exitosa!", body: "Si ves esto, las notificaciones funcionan perfecto." })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(`Error del servidor al enviar la notificación: ${data.error}`);
        } else {
          // Silencioso si fue exitoso, la notificación hablará por sí misma
        }
      } else {
        alert("Primero debes tocar 'Activar Alertas' en este dispositivo.");
      }
    } catch (err: any) {
      alert("Error de conexión al servidor: " + err.message);
    }
  };

  return (
    <div>
      {swapModalState && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '400px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '1.4rem' }}>🤝 Proponer Trueque</h3>
            <p style={{ marginBottom: '16px', fontSize: '1rem', color: 'var(--glass-text)' }}>
              Vas a ofrecer tu turno del <strong>{formatDate(swapModalState.shiftDate)}</strong>.
            </p>
            
            {!swapModalState.targetUser ? (
              <>
                <h4 style={{ marginBottom: '12px' }}>¿Con quién quieres cambiar?</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {TEAM.filter(m => m !== userName).map(member => (
                    <button 
                      key={member}
                      className="btn btn-outline"
                      style={{ padding: '10px' }}
                      onClick={() => {
                        const shifts = getAllFutureShiftsForUser(member, searchFrom, 5, approvedSwaps, seedOffset);
                        setSwapModalState({ ...swapModalState, targetUser: member, targetShifts: shifts });
                      }}
                    >
                      {member}
                    </button>
                  ))}
                  <button className="btn btn-outline" onClick={() => setSwapModalState(null)} style={{ marginTop: '16px', borderColor: '#d32f2f', color: '#d32f2f' }}>Cancelar</button>
                </div>
              </>
            ) : (
              <>
                <h4 style={{ marginBottom: '12px' }}>Elige el turno de {swapModalState.targetUser}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {swapModalState.targetShifts?.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>{swapModalState.targetUser} no tiene turnos asignados próximamente.</p>
                  ) : (
                    swapModalState.targetShifts?.map((s, idx) => (
                      <button 
                        key={idx}
                        className="btn btn-outline"
                        style={{ textAlign: 'left', padding: '12px', borderColor: 'var(--primary-red)' }}
                        onClick={() => {
                          onFutureIssue(swapModalState.shiftDate, swapModalState.shiftName, swapModalState.targetUser!, s.date, s.shift);
                          setSwapModalState(null);
                        }}
                      >
                        <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--glass-text)' }}>{formatDate(s.date)}</span><br/>
                        <span style={{ fontSize: '0.9rem', color: 'var(--glass-text)' }}>Turno {s.shift}</span>
                      </button>
                    ))
                  )}
                  
                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button className="btn btn-outline" onClick={() => setSwapModalState({ ...swapModalState, targetUser: null, targetShifts: null })} style={{ flex: 1 }}>Atrás</button>
                    <button className="btn btn-outline" onClick={() => setSwapModalState(null)} style={{ flex: 1, borderColor: '#d32f2f', color: '#d32f2f' }}>Cancelar</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h4 style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '1px' }}>
          {formatDate(currentDate)}
        </h4>
        <h3 style={{ textShadow: '0 2px 4px rgba(255,255,255,0.5)' }}>Hola, {userName}</h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '10px' }}>
          <button onClick={onChangePassword} style={{ background: 'none', border: 'none', color: 'var(--primary-red)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}>
            Cambiar clave
          </button>
          <button onClick={handleEnablePush} style={{ background: 'none', border: 'none', color: '#4caf50', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}>
            Activar Alertas
          </button>
          <button onClick={handleTestPush} style={{ background: 'none', border: 'none', color: '#1976d2', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}>
            Probar Alerta
          </button>
        </div>
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
                        <button className="btn btn-outline" onClick={() => setSwapModalState({ shiftDate: shiftInfo.date, shiftName: shiftInfo.shift, targetUser: null, targetShifts: null })} style={{ padding: '8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
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

      {/* Sección de Novedades */}
      <div style={{ marginTop: '24px' }}>
        <h4 style={{ marginBottom: '16px', fontSize: '1.2rem', color: 'var(--primary-red)' }}>📢 Novedades y Avisos</h4>
        {announcements.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>No hay avisos recientes.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {announcements.map((ann, idx) => {
              const lines = ann.text.split('\n');
              const title = lines[0];
              const body = lines.slice(1).join('\n');
              
              return (
                <div key={ann.id || idx} className="glass-card" style={{ padding: '16px', borderLeft: '4px solid var(--primary-red)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {ann.timestamp?.seconds ? new Date(ann.timestamp.seconds * 1000).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Reciente'}
                  </div>
                  <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>{title}</h3>
                  <p style={{ whiteSpace: 'pre-wrap', color: 'var(--glass-text)', fontSize: '0.95rem', marginBottom: ann.fileUrl ? '16px' : '0' }}>
                    {body}
                  </p>
                  
                  {ann.fileUrl && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      
                      {/* Previews condicionales */}
                      {(ann.fileType?.startsWith('image/') || (!ann.fileType && ann.fileUrl.match(/\.(jpeg|jpg|gif|png)$/i))) && (
                        <div style={{ position: 'relative', width: '100%', maxHeight: '400px', overflow: 'hidden', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                           <img src={ann.fileUrl} alt="Preview adjunto" style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain', backgroundColor: 'rgba(0,0,0,0.5)' }} />
                        </div>
                      )}

                      {(ann.fileType?.startsWith('video/') || (!ann.fileType && ann.fileUrl.match(/\.(mp4|webm|ogg)$/i))) && (
                        <video src={ann.fileUrl} controls style={{ width: '100%', maxHeight: '400px', borderRadius: '8px', backgroundColor: '#000', border: '1px solid var(--glass-border)' }} />
                      )}

                      {(ann.fileType === 'application/pdf' || (!ann.fileType && ann.fileUrl.match(/\.pdf$/i))) && (
                        <iframe src={`https://docs.google.com/gview?url=${ann.fileUrl}&embedded=true`} style={{ width: '100%', height: '350px', border: 'none', borderRadius: '8px', backgroundColor: '#fff' }} title="PDF Preview" />
                      )}

                      <a 
                        href={ann.fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn btn-outline"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', textDecoration: 'none', alignSelf: 'flex-start' }}
                      >
                        📎 {ann.fileName ? `Descargar ${ann.fileName.slice(0, 25)}${ann.fileName.length > 25 ? '...' : ''}` : 'Descargar Adjunto'}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminView({ schedule, statuses, activityLog, resetRequests, futureRequests, approvedSwaps, announcements, onChangeAssignment, onRejectAssignment, onResetPassword, onDismissFutureRequest, onRejectFutureRequest, onRandomReassign, onDeleteAnnouncement, youtubeLiveUrl, onUpdateYoutubeLive }: { 
  schedule: any, statuses: Record<string, Status>, activityLog: ActivityEntry[], resetRequests: string[], futureRequests: FutureChangeRequest[], approvedSwaps: ApprovedSwap[], announcements: Announcement[], onChangeAssignment: (member: string) => void, onRejectAssignment: (member: string) => void, onResetPassword: (member: string) => void, onDismissFutureRequest: (id: string) => void, onRejectFutureRequest: (req: FutureChangeRequest) => void, onRandomReassign: () => void, onDeleteAnnouncement: (id: string) => void, youtubeLiveUrl?: string, onUpdateYoutubeLive?: (url: string) => void
}) {
  const [newsTitle, setNewsTitle] = useState("");
  const [newsText, setNewsText] = useState("");
  const [newsFile, setNewsFile] = useState<File | null>(null);
  const [isUploadingNews, setIsUploadingNews] = useState(false);
  const newsFileInputRef = useRef<HTMLInputElement>(null);

  const handlePostAnnouncement = async () => {
    if (!newsTitle.trim() || !newsText.trim()) {
      alert("Debes escribir un título y una descripción.");
      return;
    }

    setIsUploadingNews(true);
    try {
      let fileUrl = null;
      let fileName = null;
      let fileType = null;

      if (newsFile) {
        const formData = new FormData();
        formData.append("file", newsFile);
        formData.append("upload_preset", "chat_iasd"); 

        const res = await fetch(`https://api.cloudinary.com/v1_1/df2phyuoo/upload`, {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Error al subir a Cloudinary");

        fileUrl = data.secure_url;
        fileName = newsFile.name;
        fileType = newsFile.type || data.resource_type;
      }

      await addDoc(collection(db, "announcements"), {
        text: `${newsTitle}\n\n${newsText}`,
        fileUrl,
        fileName,
        fileType,
        author: "Administrador",
        timestamp: serverTimestamp()
      });

      setNewsTitle("");
      setNewsText("");
      setNewsFile(null);
      if (newsFileInputRef.current) newsFileInputRef.current.value = "";
      alert("¡Anuncio publicado en el tablón de novedades!");

      // Notificar a todos
      TEAM.forEach(member => {
        sendPushNotification(member, `📢 Nuevo Aviso: ${newsTitle}`, "El administrador ha publicado una nueva novedad en la App.");
      });
    } catch (err: any) {
alert("Error al publicar: " + err.message);
    } finally {
      setIsUploadingNews(false);
    }
  };

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
              <div style={{ display: 'flex', gap: '8px' }}>
                {status === 'CHANGE_REQUESTED' && (
                  <button 
                    onClick={() => onRejectAssignment(member)}
                    style={{ padding: '8px 12px', background: 'rgba(211,47,47,0.2)', border: '1px solid #d32f2f', color: '#d32f2f', borderRadius: '6px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                  >
                    Rechazar
                  </button>
                )}
                <button 
                  onClick={() => onChangeAssignment(member)}
                  style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.2)', border: '1px solid var(--glass-border)', color: 'var(--glass-text)', borderRadius: '6px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                >
                  Cambiar
                </button>
              </div>
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

      <div className="glass-card" style={{ marginBottom: '24px', border: '1px solid var(--primary-red)' }}>
        <h3 style={{ marginBottom: '16px' }}>📢 Publicar Novedad</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input 
            type="text" 
            placeholder="Título del anuncio..." 
            value={newsTitle}
            onChange={(e) => setNewsTitle(e.target.value)}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', fontSize: '1rem' }}
          />
          <textarea 
            placeholder="Escribe los detalles aquí..." 
            value={newsText}
            onChange={(e) => setNewsText(e.target.value)}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', minHeight: '100px', fontSize: '1rem', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input 
              type="file" 
              ref={newsFileInputRef}
              onChange={(e) => setNewsFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx"
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
      </div>

      {announcements.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ marginBottom: '12px', color: 'var(--text-muted)' }}>Novedades Publicadas</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {announcements.map((ann, idx) => (
              <div key={ann.id || idx} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <strong style={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ann.text.split('\n')[0]}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {ann.timestamp?.seconds ? new Date(ann.timestamp.seconds * 1000).toLocaleDateString() : 'Reciente'}
                  </span>
                </div>
                <button 
                  onClick={() => ann.id && onDeleteAnnouncement(ann.id)}
                  style={{ background: 'none', border: 'none', color: '#d32f2f', fontSize: '1.2rem', cursor: 'pointer', padding: '8px' }}
                  title="Eliminar Novedad"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => onRejectFutureRequest(req)}
                      style={{ padding: '6px 10px', background: 'rgba(211,47,47,0.2)', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Rechazar
                    </button>
                    <button 
                      onClick={() => onDismissFutureRequest(req.id)}
                      style={{ padding: '6px 10px', background: 'none', color: 'var(--glass-text)', border: '1px solid var(--glass-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Aprobar/Leída
                    </button>
                  </div>
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

      <div style={{ marginTop: '2rem', padding: '20px', background: 'rgba(255, 0, 0, 0.1)', border: '1px solid rgba(255, 0, 0, 0.3)', borderRadius: '12px' }}>
        <h3 style={{ color: '#ff0000', marginBottom: '16px' }}>📺 Configuración de YouTube Live</h3>
        <p style={{ color: 'var(--glass-text)', marginBottom: '16px', fontSize: '0.9rem' }}>
          Para que los usuarios puedan monitorear el Vivo, pega el <strong>ID del Canal</strong> (ej: <code>UCxyz123...</code>) o el link del video en vivo.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input 
            type="text" 
            placeholder="URL o ID de YouTube..." 
            defaultValue={youtubeLiveUrl || ""}
            id="youtube-live-input"
            style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.05)', color: 'var(--glass-text)', fontSize: '1rem' }}
          />
          <button 
            onClick={() => {
              const el = document.getElementById("youtube-live-input") as HTMLInputElement;
              if (el && onUpdateYoutubeLive) onUpdateYoutubeLive(el.value);
            }}
            className="btn btn-primary"
            style={{ width: 'auto', padding: '0 20px', background: '#ff0000' }}
          >
            Guardar
          </button>
        </div>
      </div>

      <div style={{ marginTop: '2rem', padding: '20px', background: 'rgba(211,47,47,0.1)', border: '1px solid rgba(211,47,47,0.3)', borderRadius: '12px' }}>
        <h3 style={{ color: '#d32f2f', marginBottom: '16px' }}>⚙️ Zona de Peligro</h3>
        <p style={{ color: 'var(--glass-text)', marginBottom: '16px', fontSize: '0.9rem' }}>
          Utiliza este botón solo si necesitas reiniciar por completo el calendario matemático (por ejemplo, para el nuevo trimestre). Borrará todas las confirmaciones y trueques actuales.
        </p>
        <button 
          onClick={onRandomReassign}
          style={{ width: '100%', padding: '12px', background: '#d32f2f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem' }}
        >
          🎲 Reasignar Aleatoriamente Todos los Turnos
        </button>
      </div>

    </div>
  );
}

interface ChatMessage {
  id: string;
  chatId: string;
  sender: string;
  text: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  timestamp: any;
  pinned?: boolean;
}

function ChatView({ currentUser, unreadCounts, onClose }: { currentUser: UserState, unreadCounts: Record<string, number>, onClose: () => void }) {
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedChat) return;

    const chatId = selectedChat === "group" 
      ? "group" 
      : [currentUser.name, selectedChat].sort().join("_");

    const q = query(collection(db, "messages"), orderBy("timestamp", "asc"));
    
    const unsub = onSnapshot(q, (snap) => {
      const msgs: ChatMessage[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.chatId === chatId) {
          msgs.push({
            id: docSnap.id,
            chatId: data.chatId,
            sender: data.sender,
            text: data.text,
            fileUrl: data.fileUrl,
            fileName: data.fileName,
            fileType: data.fileType,
            timestamp: data.timestamp,
            pinned: data.pinned || false
          });
        }
      });
      setMessages(msgs);
      setTimeout(() => {
        const chatContainer = document.getElementById("chat-messages-container");
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        
        // Clear unread count when reading
        setDoc(doc(db, "users", currentUser.name), {
          [`unreadCounts.${chatId}`]: 0
        }, { merge: true });
      }, 50);
    });

    // Initial clear when opening
    setDoc(doc(db, "users", currentUser.name), {
      [`unreadCounts.${chatId}`]: 0
    }, { merge: true });

    return () => unsub();
  }, [selectedChat, currentUser.name]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat) return;

    const chatId = selectedChat === "group" 
      ? "group" 
      : [currentUser.name, selectedChat].sort().join("_");

    const textToSend = newMessage.trim();
    setNewMessage("");

    await addDoc(collection(db, "messages"), {
      chatId,
      sender: currentUser.name,
      text: textToSend,
      timestamp: serverTimestamp()
    });

    if (selectedChat === "group") {
      TEAM.forEach(member => {
        if (member !== currentUser.name) {
          setDoc(doc(db, "users", member), { 
            [`unreadCounts.group`]: increment(1) 
          }, { merge: true });
        }
      });
    } else {
      setDoc(doc(db, "users", selectedChat), { 
        [`unreadCounts.${chatId}`]: increment(1) 
      }, { merge: true });
      
      // Notificar por push al usuario
      sendPushNotification(selectedChat, `Nuevo mensaje de ${currentUser.name}`, textToSend);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (confirm("¿Estás seguro de que deseas eliminar este mensaje para todos?")) {
      await deleteDoc(doc(db, "messages", msgId));
    }
  };

  const handleSaveEdit = async () => {
    if (!editingMessageId) return;
    await setDoc(doc(db, "messages", editingMessageId), { text: editingMessageText }, { merge: true });
    setEditingMessageId(null);
    setEditingMessageText("");
  };

  const handleTogglePin = async (msg: ChatMessage) => {
    await setDoc(doc(db, "messages", msg.id), { pinned: !msg.pinned }, { merge: true });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat) return;

    const chatId = selectedChat === "group" 
      ? "group" 
      : [currentUser.name, selectedChat].sort().join("_");

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', 'chat_iasd');

      const res = await fetch(`https://api.cloudinary.com/v1_1/df2phyuoo/auto/upload`, {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Error al subir a Cloudinary");
      }

      const downloadURL = data.secure_url;
      
      await addDoc(collection(db, "messages"), {
        chatId,
        sender: currentUser.name,
        text: "",
        fileUrl: downloadURL,
        fileName: file.name,
        fileType: file.type || data.resource_type,
        timestamp: serverTimestamp()
      });

      if (selectedChat === "group") {
        TEAM.forEach(member => {
          if (member !== currentUser.name) {
            setDoc(doc(db, "users", member), { 
              [`unreadCounts.group`]: increment(1) 
            }, { merge: true });
          }
        });
      } else {
        setDoc(doc(db, "users", selectedChat), { 
          [`unreadCounts.${chatId}`]: increment(1) 
        }, { merge: true });

        sendPushNotification(selectedChat, `Archivo de ${currentUser.name}`, `Ha enviado un archivo adjunto.`);
      }
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error(err);
      alert("Error al subir el archivo. " + (err as Error).message);
      setIsUploading(false);
    }
  };

  return (
    <div className="chat-modal">
      <div className="chat-header">
        <button onClick={() => selectedChat ? setSelectedChat(null) : onClose()} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.2rem', cursor: 'pointer', marginRight: '16px' }}>
          {selectedChat ? '← Atrás' : '✕ Cerrar'}
        </button>
        <h3 style={{ margin: 0 }}>{selectedChat === "group" ? "Chat Grupal" : selectedChat || "Mensajes"}</h3>
      </div>

      {!selectedChat ? (
        <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
          <button 
            className="btn btn-primary" 
            style={{ marginBottom: '16px', background: 'linear-gradient(135deg, #1976d2, #115293)', position: 'relative' }}
            onClick={() => setSelectedChat("group")}
          >
            👥 Chat Grupal (Equipo IASD)
            {(unreadCounts["group"] || 0) > 0 && (
              <span style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'red', color: 'white', borderRadius: '12px', minWidth: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', fontSize: '0.85rem', fontWeight: 'bold', zIndex: 10 }}>
                {unreadCounts["group"]}
              </span>
            )}
          </button>
          
          <h4 style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Chats Directos</h4>
          {TEAM.filter(m => m !== currentUser.name).map(member => {
            const chatId = [currentUser.name, member].sort().join("_");
            const unread = unreadCounts[chatId] || 0;
            return (
              <div 
                key={member}
                onClick={() => setSelectedChat(member)}
                style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '20px', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                    👤
                  </div>
                  <strong style={{ fontSize: '1.1rem', color: 'var(--glass-text)' }}>{member}</strong>
                </div>
                {unread > 0 && (
                  <div style={{ background: 'red', color: 'white', borderRadius: '12px', minWidth: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                    {unread}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {messages.filter(m => m.pinned).length > 0 && (
            <div style={{ background: 'rgba(255, 152, 0, 0.1)', borderBottom: '1px solid rgba(255, 152, 0, 0.3)', padding: '8px 16px', maxHeight: '100px', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ff9800', display: 'flex', alignItems: 'center', gap: '4px' }}>📌 Mensajes Fijados</h4>
              {messages.filter(m => m.pinned).map(pMsg => (
                <div key={pMsg.id} style={{ fontSize: '0.85rem', color: 'var(--glass-text)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                    <strong>{pMsg.sender}:</strong> {pMsg.text || (pMsg.fileType?.startsWith('image/') ? '📷 Imagen' : '📎 Archivo')}
                  </span>
                  <button onClick={() => handleTogglePin(pMsg)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'underline' }}>Desfijar</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ background: 'rgba(255, 235, 59, 0.15)', padding: '6px', textAlign: 'center', fontSize: '0.75rem', color: '#fbc02d', fontWeight: 'bold' }}>
            ⚠️ Los mensajes no fijados se eliminan automáticamente después de 15 días.
          </div>
          <div id="chat-messages-container" className="chat-messages">
            {messages.map(msg => {
              const isMine = msg.sender === currentUser.name;
              return (
                <div key={msg.id} className={`chat-bubble ${isMine ? 'chat-bubble-mine' : 'chat-bubble-other'}`}>
                  {!isMine && selectedChat === "group" && (
                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1976d2', marginBottom: '4px' }}>
                      {msg.sender}
                    </div>
                  )}
                  
                  {editingMessageId === msg.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px' }}>
                      <textarea 
                        value={editingMessageText} 
                        onChange={(e) => setEditingMessageText(e.target.value)} 
                        style={{ width: '100%', padding: '8px', borderRadius: '8px', border: 'none', fontSize: '1rem', color: 'black' }} 
                      />
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditingMessageId(null)} style={{ background: 'none', border: '1px solid white', color: 'white', padding: '4px 12px', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
                        <button onClick={handleSaveEdit} style={{ background: 'white', border: 'none', color: '#2e7d32', fontWeight: 'bold', padding: '4px 12px', borderRadius: '8px', cursor: 'pointer' }}>Guardar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {msg.text && <div style={{ wordBreak: 'break-word' }}>{msg.text}</div>}
                      
                      {msg.fileUrl && (
                        <div style={{ marginTop: msg.text ? '8px' : '0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {msg.fileType?.startsWith('image/') ? (
                            <img src={msg.fileUrl} alt={msg.fileName} style={{ maxWidth: '100%', borderRadius: '8px', maxHeight: '250px', objectFit: 'cover' }} />
                          ) : msg.fileType?.startsWith('video/') ? (
                            <video src={msg.fileUrl} controls style={{ maxWidth: '100%', borderRadius: '8px', maxHeight: '250px' }} />
                          ) : msg.fileType?.startsWith('audio/') ? (
                            <audio src={msg.fileUrl} controls style={{ maxWidth: '100%', width: '220px' }} />
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', color: 'inherit' }}>
                              📄 {msg.fileName}
                            </div>
                          )}
                          <a 
                            href={msg.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: isMine ? 'white' : '#1976d2', textDecoration: 'none', alignSelf: 'flex-start', padding: '6px 12px', background: isMine ? 'rgba(0,0,0,0.2)' : 'rgba(25, 118, 210, 0.1)', borderRadius: '6px', fontWeight: 'bold' }}
                          >
                            ⬇️ Descargar {msg.fileType?.startsWith('image/') ? 'Imagen' : msg.fileType?.startsWith('video/') ? 'Video' : 'Archivo'}
                          </a>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '6px', borderTop: isMine ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(0,0,0,0.1)', paddingTop: '6px' }}>
                        <button onClick={() => handleTogglePin(msg)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: isMine ? 'rgba(255,255,255,0.9)' : '#1976d2' }}>
                          {msg.pinned ? '📌 Desfijar' : '📌 Fijar'}
                        </button>
                        {isMine && msg.text && (
                          <button onClick={() => { setEditingMessageId(msg.id); setEditingMessageText(msg.text); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'rgba(255,255,255,0.9)' }}>✏️ Editar</button>
                        )}
                        {isMine && (
                          <button onClick={() => handleDeleteMessage(msg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'rgba(255,255,255,0.9)' }}>🗑️ Borrar</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <form onSubmit={handleSend} className="chat-input-area">
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileSelect} 
            />
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', padding: '0 8px', opacity: isUploading ? 0.5 : 1 }}
            >
              📎
            </button>
            <input 
              type="text" 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={isUploading ? "Subiendo archivo..." : "Escribe un mensaje..."}
              disabled={isUploading}
              style={{ flex: 1, padding: '12px', borderRadius: '20px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--glass-text)', fontSize: '1rem' }}
            />
            <button type="submit" disabled={isUploading || !newMessage.trim()} style={{ background: '#4caf50', color: 'white', border: 'none', borderRadius: '20px', padding: '0 20px', fontWeight: 'bold', cursor: 'pointer', opacity: (isUploading || !newMessage.trim()) ? 0.5 : 1 }}>
              Enviar
            </button>
          </form>
        </>
      )}
    </div>
  );
}

