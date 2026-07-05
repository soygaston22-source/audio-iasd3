const fs = require('fs');
const file = 'src/lib/rotation.ts';
let content = fs.readFileSync(file, 'utf8');

// Update getScheduleForDate signature
content = content.replace(
  'export function getScheduleForDate(date: Date, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0) {',
  'export interface Unavailability {\n  date: string;\n  user: string;\n}\n\nexport function getScheduleForDate(date: Date, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0, unavailabilities: Unavailability[] = []) {'
);

// Update logic to filter out unavailable people
const oldLogic = `  let available = TEAM.filter(m => m !== "Santiago");
  
  // Sort available pseudo-randomly
  available = available.sort((a, b) => {
    return seededRandom(baseSeed + a.charCodeAt(0)) - 0.5;
  });
  
  let morning = [available[0], available[1]];
  
  // Santiago goes to afternoon, plus one more random person
  let afternoon = ["Santiago", available[2]];
  
  // Optionally shuffle afternoon so Santiago is not always first
  if (seededRandom(baseSeed + 999) > 0.5) {
    afternoon = [available[2], "Santiago"];
  }`;

const newLogic = `  let available = TEAM.filter(m => {
    const isUnavailable = unavailabilities.some(u => u.date === scheduleDate && u.user === m);
    return !isUnavailable && m !== "Santiago";
  });
  
  // Sort available pseudo-randomly
  available = available.sort((a, b) => {
    return seededRandom(baseSeed + a.charCodeAt(0)) - 0.5;
  });
  
  let morning = [];
  if (available.length >= 2) {
    morning = [available[0], available[1]];
  } else {
    // Fallback if not enough people
    morning = available.slice(0, 2);
  }
  
  let afternoon = [];
  const santiagoUnavailable = unavailabilities.some(u => u.date === scheduleDate && u.user === "Santiago");
  
  if (santiagoUnavailable) {
    // If Santiago is unavailable, we need two normal people for afternoon
    afternoon = available.slice(2, 4);
  } else {
    // Santiago goes to afternoon, plus one more random person
    const secondPerson = available.length > 2 ? available[2] : (available[0] || "Nadie");
    afternoon = ["Santiago", secondPerson];
    
    // Optionally shuffle afternoon so Santiago is not always first
    if (seededRandom(baseSeed + 999) > 0.5) {
      afternoon = [secondPerson, "Santiago"];
    }
  }`;

content = content.replace(oldLogic, newLogic);

// Update getAllFutureShiftsForUser signature and call
content = content.replace(
  'export function getAllFutureShiftsForUser(userName: string, fromDate: Date = new Date(), limit: number = 5, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0) {',
  'export function getAllFutureShiftsForUser(userName: string, fromDate: Date = new Date(), limit: number = 5, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0, unavailabilities: Unavailability[] = []) {'
);

content = content.replace(
  'const sched = getScheduleForDate(searchDate, approvedSwaps, seedOffset);',
  'const sched = getScheduleForDate(searchDate, approvedSwaps, seedOffset, unavailabilities);'
);

fs.writeFileSync(file, content);
console.log('rotation.ts patched');
