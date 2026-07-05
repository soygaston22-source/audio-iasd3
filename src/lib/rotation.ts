export const TEAM = [
  "Josias",
  "Valentino",
  "Santiago",
  "Leonel",
  "Tomas",
  "Facundo",
  "Anibal",
  "Gaston"
];

// Simple seeded PRNG
function seededRandom(seed: number) {
  let t = seed += 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface AIScheduleWeek {
  date: string;
  morning: string[];
  afternoon: string[];
}

export interface ApprovedSwap {
  date1: string;
  user1: string;
  date2: string;
  user2: string;
}

export function getWeekNumber(d: Date): { weekNo: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekNo, year: date.getUTCFullYear() };
}





export function formatDate(dateStr: string | Date): string {
  let d: Date;
  if (typeof dateStr === 'string') {
    // Agregamos T12:00:00 para forzar el parseo al mediodía local.
    // Esto evita que por la zona horaria (ej: -3 o -4) la fecha se retrase al día anterior (viernes).
    d = new Date(`${dateStr}T12:00:00`);
  } else {
    d = dateStr;
  }
  const formatter = new Intl.DateTimeFormat('es-ES', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });
  const formatted = formatter.format(d);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function getAllFutureShiftsForUser(userName: string, aiSchedules: AIScheduleWeek[] = [], limit: number = 5, approvedSwaps: ApprovedSwap[] = []) {
  const shifts: {shift: string, date: string}[] = [];
  
  // Sort schedules by date
  const sortedSchedules = [...aiSchedules].sort((a, b) => a.date.localeCompare(b.date));

  for (const sched of sortedSchedules) {
    let morning = [...sched.morning];
    let afternoon = [...sched.afternoon];

    // Apply approved swaps overrides
    approvedSwaps.forEach(swap => {
      if (swap.date1 === sched.date) {
        morning = morning.map(m => m === swap.user1 ? swap.user2 : m);
        afternoon = afternoon.map(m => m === swap.user1 ? swap.user2 : m);
      }
      if (swap.date2 === sched.date) {
        morning = morning.map(m => m === swap.user2 ? swap.user1 : m);
        afternoon = afternoon.map(m => m === swap.user2 ? swap.user1 : m);
      }
    });

    if (morning.includes(userName)) {
      shifts.push({ shift: "Mañana", date: sched.date });
    } else if (afternoon.includes(userName)) {
      shifts.push({ shift: "Tarde", date: sched.date });
    }
    
    if (shifts.length >= limit) break;
  }
  return shifts;
}
