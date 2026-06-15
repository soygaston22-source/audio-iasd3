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

export function getScheduleForDate(date: Date, approvedSwaps: ApprovedSwap[] = []) {
  const { weekNo, year } = getWeekNumber(date);
  
  // A "block" is a 2-week period where all 8 members serve exactly once.
  // weekNo is 1-indexed. Let's make it 0-indexed for math.
  const wIndex = weekNo - 1;
  const blockNumber = Math.floor(wIndex / 2);
  const weekWithinBlock = wIndex % 2; // 0 or 1
  
  // Seed based on year and blockNumber to get a deterministic shuffle for this 2-week period
  const seed = year * 1000 + blockNumber;
  let randomQueue = [...TEAM];
  
  // Deterministic shuffle
  for (let i = randomQueue.length - 1; i > 0; i--) {
    // Generate pseudo-random number for index j
    // We add i to the seed logic so it changes each iteration
    const rand = seededRandom(seed + i * 10);
    const j = Math.floor(rand * (i + 1));
    [randomQueue[i], randomQueue[j]] = [randomQueue[j], randomQueue[i]];
  }
  
  // Now we have a shuffled array of 8 members.
  // Week 0 gets indices 0-3, Week 1 gets indices 4-7.
  const startIndex = weekWithinBlock * 4;
  const selectedMembers = randomQueue.slice(startIndex, startIndex + 4);
  
  // Calculate exact date of the Saturday for this week
  // Date given is current date, we want the Saturday of this week
  const dateObj = new Date(Date.UTC(year, 0, 1)); // start of year
  dateObj.setUTCDate(dateObj.getUTCDate() + (weekNo - 1) * 7); // add weeks
  const day = dateObj.getUTCDay();
  // Saturday is 6
  const diff = 6 - day;
  dateObj.setUTCDate(dateObj.getUTCDate() + diff);
  
  const scheduleDate = dateObj.toISOString().split('T')[0];
  let morning = [selectedMembers[0], selectedMembers[1]];
  let afternoon = [selectedMembers[2], selectedMembers[3]];

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

export function getAllFutureShiftsForUser(userName: string, fromDate: Date = new Date(), limit: number = 5, approvedSwaps: ApprovedSwap[] = []) {
  let searchDate = new Date(fromDate);
  const shifts = [];
  
  // Search up to 2 years ahead if necessary
  for (let i = 0; i < 104; i++) { 
    const sched = getScheduleForDate(searchDate, approvedSwaps);
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
