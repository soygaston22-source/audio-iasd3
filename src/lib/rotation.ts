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

// Patrón de 4 semanas según el cronograma (Inicia el Sábado 11 de Julio de 2026)
const SCHEDULE_CYCLE = [
  { morning: ["Josias", "Valentino"], afternoon: ["Santiago", "Valentino"] }, // Semana 1 (ej: 11/07)
  { morning: ["Facundo", "Anibal"], afternoon: ["Leonel", "Tomas"] },         // Semana 2 (ej: 18/07)
  { morning: ["Gaston", "Josias"], afternoon: ["Santiago", "Valentino"] },    // Semana 3 (ej: 25/07)
  { morning: ["Leonel", "Tomas"], afternoon: ["Gaston", "Anibal"] }           // Semana 4 (ej: 04/07 ó 01/08)
];

const BASE_SATURDAY = new Date(Date.UTC(2026, 6, 11)); // 11 de Julio de 2026

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

export function getScheduleForDate(date: Date, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0) {
  const { weekNo, year } = getWeekNumber(date);
  
  // Calculate exact date of the Saturday for this week
  const dateObj = new Date(Date.UTC(year, 0, 1)); // start of year
  dateObj.setUTCDate(dateObj.getUTCDate() + (weekNo - 1) * 7); // add weeks
  const day = dateObj.getUTCDay();
  // Saturday is 6
  const diff = 6 - day;
  dateObj.setUTCDate(dateObj.getUTCDate() + diff);
  
  const scheduleDate = dateObj.toISOString().split('T')[0];
  
  // Calculate difference in weeks from BASE_SATURDAY
  const targetTime = dateObj.getTime();
  const baseTime = BASE_SATURDAY.getTime();
  const diffInDays = Math.round((targetTime - baseTime) / (1000 * 60 * 60 * 24));
  let diffInWeeks = Math.floor(diffInDays / 7);
  
  // Modulo 4 for the cycle (handle negative weeks safely)
  let cycleIndex = diffInWeeks % 4;
  if (cycleIndex < 0) {
    cycleIndex += 4;
  }

  // Get base assignment from cycle
  const baseAssignment = SCHEDULE_CYCLE[cycleIndex];
  
  let morning = [...baseAssignment.morning];
  let afternoon = [...baseAssignment.afternoon];

  // Apply approved swaps overrides
  approvedSwaps.forEach(swap => {
    if (swap.date1 === scheduleDate) {
      morning = morning.map(m => m === swap.user1 ? swap.user2 : m);
      afternoon = afternoon.map(m => m === swap.user1 ? swap.user2 : m);
    }
    if (swap.date2 === scheduleDate) {
      morning = morning.map(m => m === swap.user2 ? swap.user1 : m);
      afternoon = afternoon.map(m => m === swap.user2 ? swap.user1 : m);
    }
  });

  return {
    morning,
    afternoon,
    weekNo,
    year,
    date: scheduleDate
  };
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

export function getAllFutureShiftsForUser(userName: string, fromDate: Date = new Date(), limit: number = 5, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0) {
  let searchDate = new Date(fromDate);
  const shifts = [];
  
  // Search up to 2 years ahead if necessary
  for (let i = 0; i < 104; i++) { 
    const sched = getScheduleForDate(searchDate, approvedSwaps, seedOffset);
    if (sched.morning.includes(userName)) {
      shifts.push({ shift: "Mañana", date: sched.date });
    } else if (sched.afternoon.includes(userName)) {
      shifts.push({ shift: "Tarde", date: sched.date });
    }
    
    if (shifts.length >= limit) break;
    
    // advance 1 week
    searchDate.setUTCDate(searchDate.getUTCDate() + 7);
  }
  return shifts;
}
