const fs = require('fs');
const file = 'src/lib/rotation.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Export AIScheduleWeek
if (!content.includes('export interface AIScheduleWeek')) {
  content = content.replace(
    'export interface ApprovedSwap {',
    `export interface AIScheduleWeek {
  date: string;
  morning: string[];
  afternoon: string[];
}

export interface ApprovedSwap {`
  );
}

// 2. Remove FIXED_ROTATION and rewrite getAllFutureShiftsForUser
content = content.replace(/const FIXED_ROTATION[\s\S]*?\];/g, '');

const newGetAllFuture = `export function getAllFutureShiftsForUser(userName: string, aiSchedules: AIScheduleWeek[] = [], limit: number = 5, approvedSwaps: ApprovedSwap[] = []) {
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
}`;

content = content.replace(/export function getAllFutureShiftsForUser[\s\S]*?return shifts;\n\}/g, newGetAllFuture);

fs.writeFileSync(file, content);
console.log('Patched rotation.ts successfully!');
